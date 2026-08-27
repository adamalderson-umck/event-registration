-- Retire PR #37 without rewriting its already-applied migration or deleting data.
-- Also handles environments where the polling job was unscheduled operationally.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'retry-registration-lifecycle-emails'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.retry_registration_email_delivery(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_registration_email_delivery_statuses(uuid, uuid);
DROP FUNCTION IF EXISTS private.registration_lifecycle_delivery(
  uuid, text, timestamptz, timestamptz, timestamptz
);
