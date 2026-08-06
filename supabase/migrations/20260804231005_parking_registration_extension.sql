ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_type text;

UPDATE public.events SET event_type = 'standard' WHERE event_type IS NULL;

ALTER TABLE public.events
    ALTER COLUMN event_type SET DEFAULT 'standard',
    ALTER COLUMN event_type SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'events_event_type_check'
          AND conrelid = 'public.events'::regclass
    ) THEN
        ALTER TABLE public.events
            ADD CONSTRAINT events_event_type_check
            CHECK (event_type IN ('standard', 'parking'));
    END IF;
END;
$$;

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS allow_in_person_payment boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.mark_registration_paid(
    p_registration_id uuid,
    p_org_id uuid
)
RETURNS SETOF public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.org_members
        WHERE org_id = p_org_id
          AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to manage this organization';
    END IF;

    RETURN QUERY
    UPDATE public.registrations
    SET payment_status = 'paid',
        payment_method = 'in_person_verified',
        payment_details = COALESCE(payment_details, '{}'::jsonb)
            || jsonb_build_object('verifiedAt', now(), 'verifiedBy', auth.uid())
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status = 'confirmed'
      AND payment_status = 'pending'
      AND payment_method = 'in_person'
    RETURNING *;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration is not an eligible pending in-person payment';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated;;
