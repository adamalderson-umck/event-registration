ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS registration_close_date timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_hours_before integer,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;;
