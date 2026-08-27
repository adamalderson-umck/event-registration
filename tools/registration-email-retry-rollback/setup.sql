-- Keep registration inserts from dispatching email or mutating capacity.
-- All changes, including trigger state, are confined to the caller's transaction.
ALTER TABLE public.registrations DISABLE TRIGGER USER;

CREATE TEMP TABLE rollback_fixture_ids ON COMMIT DROP AS
SELECT gen_random_uuid() AS org_id, gen_random_uuid() AS event_id;

INSERT INTO public.organizations (id, name, slug, owner_uid)
SELECT org_id, 'Rollback validation', org_id::text, gen_random_uuid()
FROM rollback_fixture_ids;

INSERT INTO public.events (id, org_id, title, status)
SELECT event_id, org_id, 'Rollback validation', 'draft' FROM rollback_fixture_ids;

INSERT INTO public.registrations (org_id, event_id, status, form_data)
SELECT org_id, event_id, status, '{"system_email":"rollback@example.invalid"}'::jsonb
FROM rollback_fixture_ids
CROSS JOIN (VALUES ('confirmed'), ('waitlisted'), ('cancelled')) AS states(status);

INSERT INTO public.email_deliveries (
  delivery_key, org_id, event_id, registration_id, kind, state, attempt_count, attempted_at
)
SELECT 'rollback-fixture:' || r.id, r.org_id, r.event_id, r.id,
  CASE r.status WHEN 'waitlisted' THEN 'registration_waitlist'
    WHEN 'cancelled' THEN 'registration_cancellation' ELSE 'registration_confirmation' END,
  CASE r.status WHEN 'confirmed' THEN 'sent' WHEN 'waitlisted' THEN 'failed' ELSE 'pending' END,
  1, now()
FROM public.registrations AS r
JOIN rollback_fixture_ids AS fixture ON fixture.org_id = r.org_id;

CREATE TEMP TABLE rollback_registration_snapshot ON COMMIT DROP AS
SELECT to_jsonb(r) AS row FROM public.registrations AS r;
CREATE TEMP TABLE rollback_delivery_snapshot ON COMMIT DROP AS
SELECT to_jsonb(d) AS row FROM public.email_deliveries AS d;
CREATE TEMP TABLE rollback_job_snapshot ON COMMIT DROP AS
SELECT to_jsonb(j) AS row FROM cron.job AS j
WHERE jobname IS DISTINCT FROM 'retry-registration-lifecycle-emails';
CREATE TEMP TABLE rollback_function_snapshot ON COMMIT DROP AS
SELECT p.oid, pg_get_functiondef(p.oid) AS definition
FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
  AND p.proname NOT IN ('retry_registration_email_delivery',
    'get_registration_email_delivery_statuses', 'registration_lifecycle_delivery');
CREATE TEMP TABLE rollback_trigger_snapshot ON COMMIT DROP AS
SELECT t.oid, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger AS t WHERE t.tgrelid = 'public.registrations'::regclass;
