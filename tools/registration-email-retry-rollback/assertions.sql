DO $$
BEGIN
  IF EXISTS (SELECT FROM cron.job WHERE jobname = 'retry-registration-lifecycle-emails') THEN
    RAISE EXCEPTION 'Retry polling job must be absent after correction';
  END IF;
  IF to_regprocedure('public.retry_registration_email_delivery(uuid,uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.get_registration_email_delivery_statuses(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('private.registration_lifecycle_delivery(uuid,text,timestamptz,timestamptz,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Retry-only functions must be absent after correction';
  END IF;
  IF EXISTS (
    (SELECT row FROM rollback_registration_snapshot EXCEPT ALL SELECT to_jsonb(r) FROM public.registrations r)
    UNION ALL
    (SELECT to_jsonb(r) FROM public.registrations r EXCEPT ALL SELECT row FROM rollback_registration_snapshot)
  ) THEN RAISE EXCEPTION 'Registration data changed'; END IF;
  IF EXISTS (
    (SELECT row FROM rollback_delivery_snapshot EXCEPT ALL SELECT to_jsonb(d) FROM public.email_deliveries d)
    UNION ALL
    (SELECT to_jsonb(d) FROM public.email_deliveries d EXCEPT ALL SELECT row FROM rollback_delivery_snapshot)
  ) THEN RAISE EXCEPTION 'Delivery ledger changed'; END IF;
  IF EXISTS (
    (SELECT row FROM rollback_job_snapshot EXCEPT ALL SELECT to_jsonb(j) FROM cron.job j
      WHERE jobname IS DISTINCT FROM 'retry-registration-lifecycle-emails')
    UNION ALL
    (SELECT to_jsonb(j) FROM cron.job j WHERE jobname IS DISTINCT FROM 'retry-registration-lifecycle-emails'
      EXCEPT ALL SELECT row FROM rollback_job_snapshot)
  ) THEN RAISE EXCEPTION 'Unrelated cron jobs changed'; END IF;
  IF EXISTS (
    SELECT FROM rollback_function_snapshot s LEFT JOIN pg_proc p ON p.oid = s.oid
    WHERE p.oid IS NULL OR s.definition IS DISTINCT FROM pg_get_functiondef(p.oid)
  ) THEN RAISE EXCEPTION 'Earlier functions changed'; END IF;
  IF EXISTS (
    SELECT FROM rollback_trigger_snapshot s LEFT JOIN pg_trigger t ON t.oid = s.oid
    WHERE t.oid IS NULL OR s.definition IS DISTINCT FROM pg_get_triggerdef(t.oid)
  ) THEN RAISE EXCEPTION 'Registration triggers changed'; END IF;
END;
$$;
