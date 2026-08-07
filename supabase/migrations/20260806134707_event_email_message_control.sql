ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS confirmation_message text,
  ADD COLUMN IF NOT EXISTS reminder_message text;

UPDATE public.events
SET confirmation_message = 'Thank you for registering for this parking event.'
WHERE event_type = 'parking'
  AND coalesce(btrim(confirmation_message), '') = '';

UPDATE public.events
SET reminder_message = 'This is a friendly reminder that your event is coming up soon!'
WHERE reminder_hours_before IS NOT NULL
  AND coalesce(btrim(reminder_message), '') = '';

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_active_parking_confirmation_message_check,
  ADD CONSTRAINT events_active_parking_confirmation_message_check CHECK (
    status <> 'active'
    OR event_type <> 'parking'
    OR coalesce(btrim(confirmation_message), '') <> ''
  ),
  DROP CONSTRAINT IF EXISTS events_active_reminder_message_check,
  ADD CONSTRAINT events_active_reminder_message_check CHECK (
    status <> 'active'
    OR reminder_hours_before IS NULL
    OR coalesce(btrim(reminder_message), '') <> ''
  );

CREATE TABLE public.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_key text NOT NULL UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'registration_confirmation',
    'registration_waitlist',
    'registration_cancellation',
    'waitlist_promotion',
    'organizer_notification',
    'event_reminder'
  )),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error_code text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.notify_registration_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_project_url text;
  v_service_role_key text;
BEGIN
  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_project_url IS NULL OR coalesce(v_service_role_key, '') = '' THEN
    RAISE WARNING 'Registration email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
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
  v_service_role_key text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url';

  v_service_role_key := current_setting('app.settings.service_role_key', true);

  IF v_project_url IS NULL OR coalesce(v_service_role_key, '') = '' THEN
    RAISE WARNING 'Registration email automation is not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
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
