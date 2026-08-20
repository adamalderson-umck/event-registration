-- Defer payment while a registration is waitlisted and activate it on promotion.
CREATE OR REPLACE FUNCTION public.handle_new_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_event RECORD;
  v_new_status TEXT;
BEGIN
  SELECT
    events.capacity,
    events.waitlist_enabled,
    events.registration_count,
    events.waitlist_count,
    events.payment_enabled
  INTO v_event
  FROM public.events AS events
  WHERE events.id = NEW.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', NEW.event_id;
  END IF;

  IF v_event.capacity IS NOT NULL AND v_event.registration_count >= v_event.capacity THEN
    IF v_event.waitlist_enabled THEN
      v_new_status := 'waitlisted';
    ELSE
      v_new_status := 'confirmed';
    END IF;
  ELSE
    v_new_status := 'confirmed';
  END IF;

  NEW.status := v_new_status;

  IF v_new_status = 'waitlisted' THEN
    NEW.payment_method := NULL;
    NEW.payment_status := 'not_required';
  ELSIF v_new_status = 'confirmed'
    AND v_event.payment_enabled
    AND NEW.payment_method IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'payment_selection_required';
  END IF;

  IF v_new_status = 'waitlisted' THEN
    UPDATE public.events
    SET waitlist_count = waitlist_count + 1
    WHERE id = NEW.event_id;
  ELSE
    UPDATE public.events
    SET registration_count = registration_count + 1
    WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_waitlist_payment_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_payment_enabled boolean;
BEGIN
  IF OLD.status <> 'waitlisted' OR NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT events.payment_enabled
  INTO v_payment_enabled
  FROM public.events AS events
  WHERE events.id = NEW.event_id
    AND events.org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for waitlist payment lifecycle';
  END IF;

  PERFORM pg_catalog.set_config('app.payment_projection_write', 'allowed', true);
  NEW.payment_method := NULL;
  NEW.payment_status := CASE
    WHEN v_payment_enabled THEN 'pending'
    ELSE 'not_required'
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_waitlist_payment_lifecycle()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_waitlist_payment_lifecycle()
  TO service_role;

DROP TRIGGER IF EXISTS apply_waitlist_payment_lifecycle ON public.registrations;
CREATE TRIGGER apply_waitlist_payment_lifecycle
BEFORE UPDATE OF status ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.apply_waitlist_payment_lifecycle();
