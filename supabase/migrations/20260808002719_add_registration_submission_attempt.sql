ALTER TABLE public.registrations
  ADD COLUMN submission_attempt_id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_submission_attempt_id_key
  UNIQUE (submission_attempt_id);

CREATE INDEX registrations_recent_active_email_idx
  ON public.registrations (
    org_id,
    event_id,
    ((form_data->>'system_email')),
    created_at DESC
  )
  WHERE status IN ('pending', 'confirmed', 'waitlisted');
