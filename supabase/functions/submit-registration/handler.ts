import {
  assertEventAcceptsRegistration,
  buildRegistrationInsert,
  parseRegistrationRequest,
  type EventRecord,
} from '../_shared/registration-request.ts';
import { verifyTurnstile, type VerifyTurnstileOptions } from '../_shared/turnstile.ts';

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'https://events.kentmethodist.org',
  'https://event-registration-b7840.web.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

type QueryResult<T> = Promise<{ data: T | null; error: unknown }>;

interface EventQuery {
  select(columns: string): {
    eq(column: string, value: string): {
      eq(column: string, value: string): { single(): QueryResult<EventRecord> };
    };
  };
}

interface RegistrationQuery {
  insert(value: unknown): {
    select(columns: string): { single(): QueryResult<Record<string, unknown>> };
  };
}

export interface RegistrationAdminClient {
  from(table: 'events'): EventQuery;
  from(table: 'registrations'): RegistrationQuery;
}

interface HandlerDependencies {
  adminClient: RegistrationAdminClient;
  turnstileSecret: string;
  expectedHostnames: string[];
  expectedAction: string;
  verifyTurnstileFn?: (options: VerifyTurnstileOptions) => ReturnType<typeof verifyTurnstile>;
  log?: (event: Record<string, string>) => void;
  now?: () => Date;
  requestId?: () => string;
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number, requestId: string, origin: string | null): Response {
  return json({ error: code, requestId }, status, origin);
}

function trustedRequestIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

export function createSubmitRegistrationHandler({
  adminClient,
  turnstileSecret,
  expectedHostnames,
  expectedAction,
  verifyTurnstileFn = verifyTurnstile,
  log = (event) => console.error(JSON.stringify(event)),
  now = () => new Date(),
  requestId = () => crypto.randomUUID(),
}: HandlerDependencies): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const correlationId = requestId();
    const origin = req.headers.get('origin');

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      log({ requestId: correlationId, code: 'origin_not_allowed' });
      return errorResponse('origin_not_allowed', 403, correlationId, origin);
    }
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== 'POST') {
      return errorResponse('method_not_allowed', 405, correlationId, origin);
    }
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    let request;
    try {
      request = parseRegistrationRequest(await req.json());
    } catch {
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    let verification;
    try {
      verification = await verifyTurnstileFn({
        secret: turnstileSecret,
        token: request.turnstileToken,
        remoteIp: trustedRequestIp(req),
        expectedHostnames,
        expectedAction,
      });
    } catch {
      log({ requestId: correlationId, code: 'security_verification_failed' });
      return errorResponse('security_verification_failed', 403, correlationId, origin);
    }

    const eventQuery = adminClient.from('events')
      .select('id,org_id,status,registration_close_date,payment_enabled,allow_in_person_payment,tithely_giving_url,tithely_embed_config,form_fields,waivers')
      .eq('id', request.eventId)
      .eq('org_id', request.orgId);
    const { data: event, error: eventError } = await eventQuery.single();
    if (eventError) {
      log({ requestId: correlationId, code: 'event_lookup_failed', hostname: verification.hostname });
      return errorResponse('submission_failed', 500, correlationId, origin);
    }
    if (!event) {
      return errorResponse('registration_unavailable', 409, correlationId, origin);
    }

    let registrationInsert;
    try {
      assertEventAcceptsRegistration(event, request, now());
      registrationInsert = buildRegistrationInsert(event, request, {
        ipAddress: trustedRequestIp(req),
        userAgent: req.headers.get('user-agent') || '',
        now: now(),
      });
    } catch (error) {
      const code = messageOf(error);
      if (code === 'registration_unavailable') {
        return errorResponse('registration_unavailable', 409, correlationId, origin);
      }
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    const { data: created, error: insertError } = await adminClient.from('registrations')
      .insert(registrationInsert)
      .select('id,status,payment_status,payment_method')
      .single();
    if (insertError || !created) {
      log({ requestId: correlationId, code: 'registration_insert_failed', hostname: verification.hostname });
      return errorResponse('submission_failed', 500, correlationId, origin);
    }

    return json({
      id: created.id,
      status: created.status,
      payment_status: created.payment_status,
      payment_method: created.payment_method,
    }, 200, origin);
  };
}
