CREATE OR REPLACE FUNCTION public.handle_registration_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
    v_event record;
    v_promoted record;
BEGIN
    IF OLD.status = 'cancelled' OR NEW.status != 'cancelled' THEN
        RETURN NEW;
    END IF;

    SELECT id, capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM public.events
    WHERE id = NEW.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    NEW.cancelled_at := now();

    IF OLD.status = 'waitlisted' THEN
        UPDATE public.events
        SET waitlist_count = GREATEST(waitlist_count - 1, 0)
        WHERE id = NEW.event_id;
    ELSE
        UPDATE public.events
        SET registration_count = GREATEST(registration_count - 1, 0)
        WHERE id = NEW.event_id;

        IF v_event.waitlist_enabled AND v_event.waitlist_count > 0 THEN
            SELECT id
            INTO v_promoted
            FROM public.registrations
            WHERE event_id = NEW.event_id
              AND status = 'waitlisted'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE;

            IF FOUND THEN
                UPDATE public.registrations
                SET status = 'confirmed',
                    promoted_at = now()
                WHERE id = v_promoted.id;

                UPDATE public.events
                SET registration_count = registration_count + 1,
                    waitlist_count = GREATEST(waitlist_count - 1, 0)
                WHERE id = NEW.event_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
