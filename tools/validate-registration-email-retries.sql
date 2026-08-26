\set ON_ERROR_STOP on

BEGIN;

SET LOCAL request.jwt.claims = '{"role":"service_role"}';
ALTER TABLE public.registrations DISABLE TRIGGER USER;

INSERT INTO public.organizations (id, name, slug, owner_uid)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Retry validation organization',
  'retry-validation',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

INSERT INTO public.events (id, org_id, title, status)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Retry validation event',
  'draft'
);

INSERT INTO public.registrations (
  id,
  org_id,
  event_id,
  status,
  created_at,
  promoted_at,
  cancelled_at
)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'confirmed',
    '2026-08-01T12:00:00+00:00',
    NULL,
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'waitlisted',
    '2026-08-02T12:00:00+00:00',
    NULL,
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'confirmed',
    '2026-08-03T12:00:00+00:00',
    '2026-08-04T12:00:00+00:00',
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'cancelled',
    '2026-08-04T12:00:00+00:00',
    NULL,
    '2026-08-05T12:00:00+00:00'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'confirmed',
    '2026-08-05T12:00:00+00:00',
    NULL,
    NULL
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'confirmed',
    '2026-08-06T12:00:00+00:00',
    NULL,
    NULL
  );

INSERT INTO public.email_deliveries (
  id,
  delivery_key,
  org_id,
  event_id,
  registration_id,
  kind,
  state,
  attempt_count,
  last_error_code,
  attempted_at
)
SELECT
  ('40000000-0000-4000-8000-00000000000' ||
    right(r.id::text, 1))::uuid,
  lifecycle.delivery_key,
  r.org_id,
  r.event_id,
  r.id,
  lifecycle.kind,
  CASE
    WHEN r.id = '30000000-0000-4000-8000-000000000005'::uuid
      THEN 'pending'
    ELSE 'failed'
  END,
  CASE right(r.id::text, 1)
    WHEN '1' THEN 1
    WHEN '2' THEN 2
    WHEN '3' THEN 3
    WHEN '4' THEN 4
    ELSE 1
  END,
  'smtp_send_failed',
  CASE right(r.id::text, 1)
    WHEN '1' THEN pg_catalog.now() - interval '6 minutes'
    WHEN '2' THEN pg_catalog.now() - interval '31 minutes'
    WHEN '3' THEN pg_catalog.now() - interval '121 minutes'
    WHEN '4' THEN pg_catalog.now() - interval '1 day'
    ELSE pg_catalog.now() - interval '14 minutes'
  END
FROM public.registrations AS r
CROSS JOIN LATERAL private.registration_lifecycle_delivery(
  r.id,
  r.status,
  r.created_at,
  r.promoted_at,
  r.cancelled_at
) AS lifecycle
WHERE r.id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005'
);

INSERT INTO public.email_deliveries (
  id,
  delivery_key,
  org_id,
  event_id,
  registration_id,
  kind,
  state,
  attempt_count,
  last_error_code,
  attempted_at
)
VALUES (
  '40000000-0000-4000-8000-000000000006',
  'registration_confirmation:30000000-0000-4000-8000-000000000006:2026-08-01T12:00:00+00:00',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '30000000-0000-4000-8000-000000000006',
  'registration_confirmation',
  'failed',
  4,
  'smtp_send_failed',
  pg_catalog.now() - interval '1 day'
);

DO $$
DECLARE
  v_statuses record;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM public.get_registration_email_delivery_statuses(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  ) <> 6 THEN
    RAISE EXCEPTION 'status RPC did not return every applicable registration';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000001';
  IF v_statuses.kind <> 'registration_confirmation'
     OR v_statuses.next_retry_at > pg_catalog.now()
     OR v_statuses.exhausted THEN
    RAISE EXCEPTION 'confirmation retry boundary is incorrect';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000002';
  IF v_statuses.kind <> 'registration_waitlist'
     OR v_statuses.next_retry_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'waitlist retry boundary is incorrect';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000003';
  IF v_statuses.kind <> 'waitlist_promotion'
     OR v_statuses.next_retry_at > pg_catalog.now() THEN
    RAISE EXCEPTION 'promotion retry boundary is incorrect';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000004';
  IF v_statuses.kind <> 'registration_cancellation'
     OR NOT v_statuses.exhausted
     OR v_statuses.next_retry_at IS NOT NULL THEN
    RAISE EXCEPTION 'cancellation exhaustion projection is incorrect';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000005';
  IF v_statuses.state <> 'pending'
     OR v_statuses.next_retry_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'pending lease minimum is incorrect';
  END IF;

  SELECT * INTO v_statuses
  FROM public.get_registration_email_delivery_statuses(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )
  WHERE registration_id = '30000000-0000-4000-8000-000000000006';
  IF v_statuses.delivery_id IS NOT NULL OR v_statuses.state IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete delivery key was projected';
  END IF;
END;
$$;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.retry_registration_email_delivery(
    '11111111-1111-4111-8111-111111111111',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001'
  ) INTO v_result;
  IF v_result <> '{"ok": false, "code": "not_exhausted"}'::jsonb THEN
    RAISE EXCEPTION 'manual retry did not reject a non-exhausted delivery';
  END IF;

  SELECT public.retry_registration_email_delivery(
    '11111111-1111-4111-8111-111111111111',
    '30000000-0000-4000-8000-000000000006',
    '40000000-0000-4000-8000-000000000006'
  ) INTO v_result;
  IF v_result <> '{"ok": false, "code": "not_applicable"}'::jsonb THEN
    RAISE EXCEPTION 'manual retry did not reject an obsolete delivery key';
  END IF;
END;
$$;

DELETE FROM vault.secrets
WHERE name IN ('project_url', 'email_automation_secret');
SELECT vault.create_secret(
  'http://127.0.0.1:54321',
  'project_url',
  'rollback-only retry validation'
);
SELECT vault.create_secret(
  'rollback-only-secret',
  'email_automation_secret',
  'rollback-only retry validation'
);

DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT public.retry_registration_email_delivery(
    '11111111-1111-4111-8111-111111111111',
    '30000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000004'
  ) INTO v_result;
  IF v_result <> '{"ok": true, "code": "queued"}'::jsonb THEN
    RAISE EXCEPTION 'manual retry did not queue an exhausted delivery';
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.has_table_privilege(
    'authenticated',
    'public.email_deliveries',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated role can read the delivery ledger';
  END IF;
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.get_registration_email_delivery_statuses(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon can execute the status RPC';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.get_registration_email_delivery_statuses(uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated cannot execute the status RPC';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM cron.job
    WHERE jobname = 'retry-registration-lifecycle-emails'
      AND schedule = '*/5 * * * *'
      AND command ILIKE '%LIMIT 10%'
  ) <> 1 THEN
    RAISE EXCEPTION 'retry cron schedule or batch cap is incorrect';
  END IF;
END;
$$;

ROLLBACK;
