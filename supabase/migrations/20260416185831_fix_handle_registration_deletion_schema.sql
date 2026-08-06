
CREATE OR REPLACE FUNCTION public.handle_registration_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event RECORD;
  v_promoted RECORD;
BEGIN
  -- Lock the event row
  SELECT id, capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM public.events
    WHERE id = OLD.event_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  -- Decrement appropriate counter
  IF OLD.status = 'waitlisted' THEN
    UPDATE public.events
      SET waitlist_count = GREATEST(waitlist_count - 1, 0)
      WHERE id = OLD.event_id;
  ELSIF OLD.status = 'confirmed' THEN
    UPDATE public.events
      SET registration_count = GREATEST(registration_count - 1, 0)
      WHERE id = OLD.event_id;

    -- Promote from waitlist if applicable
    IF v_event.waitlist_enabled AND v_event.waitlist_count > 0 THEN
      -- Find oldest waitlisted registration for this event
      SELECT id INTO v_promoted
        FROM public.registrations
        WHERE event_id = OLD.event_id
          AND status = 'waitlisted'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE;

      IF FOUND THEN
        -- Promote
        UPDATE public.registrations
          SET status = 'confirmed', promoted_at = now()
          WHERE id = v_promoted.id;

        -- Update counters: +1 confirmed, -1 waitlist
        UPDATE public.events
          SET registration_count = registration_count + 1,
              waitlist_count = GREATEST(waitlist_count - 1, 0)
          WHERE id = OLD.event_id;
      END IF;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;
;
