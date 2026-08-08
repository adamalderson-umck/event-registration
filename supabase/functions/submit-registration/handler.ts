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

type PublicRegistration = {
  id: unknown;
  event_id?: unknown;
  org_id?: unknown;
  status: unknown;
  payment_status: unknown;
  payment_method: unknown;
};

interface RegistrationFilterQuery {
  eq(column: string, value: string): RegistrationFilterQuery;
  in(column: string, values: string[]): RegistrationFilterQuery;
  gte(column: string, value: string): RegistrationFilterQuery;
  limit(count: number): RegistrationFilterQuery;
  maybeSingle(): QueryResult<PublicRegistration>;
}

interface RegistrationQuery {
  select(columns: string): RegistrationFilterQuery;
  insert(value: unknown): {
    select(columns: string): { single(): QueryResult<PublicRegistration> };
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
  attemptId?: () => string;
}

const PUBLIC_REGISTRATION_COLUMNS = 'id,event_id,org_id,status,payment_status,payment_method';
const ACTIVE_REGISTRATION_STATUSES = ['pending', 'confirmed', 'waitlisted'];
const RECENT_REGISTRATION_WINDOW_MS = 10 * 60 * 1000;

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

function publicRegistration(record: PublicRegistration): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    payment_status: record.payment_status,
    payment_method: record.payment_method,
  };
}

async function findAttempt(adminClient: RegistrationAdminClient, attemptId: string) {
  return await adminClient.from('registrations')
    .select(PUBLIC_REGISTRATION_COLUMNS)
    .eq('submission_attempt_id', attemptId)
    .limit(1)
    .maybeSingle();
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
  attemptId = () => crypto.randomUUID(),
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

    const requestTime = now();
    const legacyClient = request.submissionAttemptId === null;
    const effectiveAttemptId = request.submissionAttemptId ?? attemptId();

    let registrationInsert;
    try {
      assertEventAcceptsRegistration(event, request, requestTime);
      registrationInsert = {
        ...buildRegistrationInsert(event, request, {
          ipAddress: trustedRequestIp(req),
          userAgent: req.headers.get('user-agent') || '',
          now: requestTime,
        }),
        submission_attempt_id: effectiveAttemptId,
      };
    } catch (error) {
      const code = messageOf(error);
      if (code === 'registration_unavailable') {
        return errorResponse('registration_unavailable', 409, correlationId, origin);
      }
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    const attemptResult = await findAttempt(adminClient, effectiveAttemptId);
    if (attemptResult.error) {
      log({ requestId: correlationId, code: 'attempt_lookup_failed', hostname: verification.hostname });
      return errorResponse('submission_failed', 500, correlationId, origin);
    }
    if (attemptResult.data) {
      if (attemptResult.data.event_id !== request.eventId || attemptResult.data.org_id !== request.orgId) {
        return errorResponse('invalid_request', 400, correlationId, origin);
      }
      return json(publicRegistration(attemptResult.data), 200, origin);
    }

    const normalizedEmail = registrationInsert.form_data.system_email;
    if (typeof normalizedEmail !== 'string' || !normalizedEmail) {
      return errorResponse('invalid_request', 400, correlationId, origin);
    }

    if (!legacyClient && !request.recentDuplicateOverride) {
      const cutoff = new Date(requestTime.getTime() - RECENT_REGISTRATION_WINDOW_MS).toISOString();
      const recentResult = await adminClient.from('registrations')
        .select('id')
        .eq('org_id', request.orgId)
        .eq('event_id', request.eventId)
        .eq('form_data->>system_email', normalizedEmail)
        .in('status', ACTIVE_REGISTRATION_STATUSES)
        .gte('created_at', cutoff)
        .limit(1)
        .maybeSingle();

      if (recentResult.error) {
        log({
          requestId: correlationId,
          code: 'recent_registration_lookup_failed',
          hostname: verification.hostname,
        });
        return errorResponse('submission_failed', 500, correlationId, origin);
      }
      if (recentResult.data) {
        return errorResponse('recent_registration', 409, correlationId, origin);
      }
    }

    const { data: createdRecord, error: insertError } = await adminClient.from('registrations')
      .insert(registrationInsert)
      .select(PUBLIC_REGISTRATION_COLUMNS)
      .single();

    if (insertError || !createdRecord) {
      const recoveredAttempt = await findAttempt(adminClient, effectiveAttemptId);
      if (!recoveredAttempt.error && recoveredAttempt.data) {
        if (
          recoveredAttempt.data.event_id !== request.eventId ||
          recoveredAttempt.data.org_id !== request.orgId
        ) {
          return errorResponse('invalid_request', 400, correlationId, origin);
        }
        return json(publicRegistration(recoveredAttempt.data), 200, origin);
      }

      log({ requestId: correlationId, code: 'registration_insert_failed', hostname: verification.hostname });
      return errorResponse('submission_failed', 500, correlationId, origin);
    }

    return json(publicRegistration(createdRecord), 200, origin);
  };
}
