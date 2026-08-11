import {
  parseRegistrationAnswerEditRequest,
  prepareRegistrationAnswerEdit,
  type RegistrationAnswerChange,
} from '../_shared/registration-answer-edit.ts';
import type { EventRecord } from '../_shared/registration-request.ts';

type UnknownRecord = Record<string, unknown>;

interface User {
  id: string;
  email?: string | null;
}

interface Registration extends UnknownRecord {
  id: string;
  org_id: string;
  event_id: string;
  status: string;
  form_data: UnknownRecord;
}

export interface ApplyArgs {
  registrationId: string;
  orgId: string;
  eventId: string;
  editorUserId: string;
  editorDisplayName: string;
  expectedFormData: UnknownRecord;
  newFormData: UnknownRecord;
  changes: RegistrationAnswerChange[];
}

interface Dependencies {
  authenticate(req: Request): Promise<User | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  loadRegistration(id: string): Promise<Registration | null>;
  loadEvent(id: string): Promise<EventRecord | null>;
  loadEditorName(user: User): Promise<string>;
  applyEdit(args: ApplyArgs): Promise<UnknownRecord>;
  log?(event: UnknownRecord): void;
  requestId?(): string;
}

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'https://events.kentmethodist.org',
  'https://event-registration-b7840.web.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

function responseStatus(code: string): number {
  if (code === 'not_found') return 404;
  if (code === 'edit_conflict' || code === 'registration_cancelled') return 409;
  if (code === 'invalid_request') return 400;
  return 500;
}

function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function parseBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new Error('invalid_request');
  }
}

export function createUpdateRegistrationAnswersHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    const requestId = deps.requestId?.() ?? crypto.randomUUID();
    const origin = req.headers.get('origin');
    const respond = (body: unknown, status = 200) => json(body, status, origin);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== 'POST') {
      return respond({ error: 'method_not_allowed' }, 405);
    }
    if (!req.headers.get('authorization')) {
      return respond({ error: 'not_authorized' }, 401);
    }

    try {
      const user = await deps.authenticate(req);
      if (!user) return respond({ error: 'not_authorized' }, 401);

      const declaredLength = Number(req.headers.get('content-length') || 0);
      if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_BYTES) {
        return respond({ error: 'invalid_request' }, 400);
      }

      const request = parseRegistrationAnswerEditRequest(await parseBody(req));
      if (!await deps.isMember(request.orgId, user.id)) {
        return respond({ error: 'not_found' }, 404);
      }

      const registration = await deps.loadRegistration(request.registrationId);
      if (!registration || registration.org_id !== request.orgId) {
        return respond({ error: 'not_found' }, 404);
      }
      if (registration.status === 'cancelled') {
        return respond({ error: 'registration_cancelled' }, 409);
      }

      const event = await deps.loadEvent(registration.event_id);
      if (
        !event
        || event.id !== registration.event_id
        || event.org_id !== request.orgId
      ) {
        return respond({ error: 'not_found' }, 404);
      }
      if (!valuesMatch(registration.form_data, request.expectedFormData)) {
        return respond({ error: 'edit_conflict' }, 409);
      }

      const prepared = prepareRegistrationAnswerEdit(
        event,
        registration,
        request.answers,
      );
      if (prepared.changes.length === 0) {
        return respond({ registration, edit: null });
      }

      const result = await deps.applyEdit({
        registrationId: registration.id,
        orgId: registration.org_id,
        eventId: registration.event_id,
        editorUserId: user.id,
        editorDisplayName: await deps.loadEditorName(user),
        expectedFormData: request.expectedFormData,
        newFormData: prepared.formData,
        changes: prepared.changes,
      });

      if (result.ok !== true) {
        const code = typeof result.code === 'string'
          ? result.code
          : 'save_failed';
        return respond({ error: code }, responseStatus(code));
      }

      return respond({
        registration: result.registration,
        edit: result.edit,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_request') {
        return respond({ error: 'invalid_request' }, 400);
      }
      deps.log?.({ requestId, code: 'save_failed' });
      return respond({ error: 'save_failed', requestId }, 500);
    }
  };
}
