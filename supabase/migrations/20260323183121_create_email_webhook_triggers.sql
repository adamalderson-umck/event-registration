-- ============================================================
-- Store local placeholders in Vault for development
-- ============================================================
SELECT vault.create_secret(
  'http://host.docker.internal:54321',
  'project_url'
);

SELECT vault.create_secret(
  'local-anon-key-not-configured',
  'anon_key'
);

-- ============================================================
-- Database Webhook: send-registration-email (INSERT)
-- Uses pg_net to make async HTTP POST to the Edge Function
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_registration_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'registrations',
      'record', to_jsonb(NEW),
      'old_record', NULL
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_registration_insert
  AFTER INSERT ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_registration_insert();

-- ============================================================
-- Database Webhook: send-registration-email (UPDATE)
-- Handles cancellations and waitlist promotions
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_registration_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire for status changes to avoid unnecessary calls
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
             || '/functions/v1/send-registration-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
      ),
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'registrations',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_registration_update
  AFTER UPDATE ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_registration_update();

-- ============================================================
-- pg_cron: weekly-digest schedule
-- Runs every Monday at 8:00 AM ET (13:00 UTC)
-- ============================================================
SELECT cron.schedule(
  'weekly-digest',
  '0 13 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := '{"scheduled": true}'::jsonb
  ) AS request_id;
  $$
);
