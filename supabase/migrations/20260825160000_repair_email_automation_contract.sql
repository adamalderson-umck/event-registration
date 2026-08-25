CREATE OR REPLACE FUNCTION public.notify_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_automation_secret text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  SELECT decrypted_secret INTO v_automation_secret
  FROM vault.decrypted_secrets
  WHERE name = 'email_automation_secret';

  IF v_project_url IS NULL OR coalesce(v_automation_secret, '') = '' THEN
    RAISE WARNING 'Email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', v_automation_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'registration_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_registration_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_automation_secret text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  SELECT decrypted_secret INTO v_automation_secret
  FROM vault.decrypted_secrets
  WHERE name = 'email_automation_secret';

  IF v_project_url IS NULL OR coalesce(v_automation_secret, '') = '' THEN
    RAISE WARNING 'Email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', v_automation_secret
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'registration_id', NEW.id,
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

SELECT cron.schedule(
  'send-event-reminders',
  '0 * * * *',
  $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'project_url')
           || '/functions/v1/send-event-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret',
      (SELECT decrypted_secret
       FROM vault.decrypted_secrets
       WHERE name = 'email_automation_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $job$
);
