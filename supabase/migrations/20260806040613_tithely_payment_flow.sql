ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS tithely_giving_url text,
    ADD COLUMN IF NOT EXISTS tithely_embed_config jsonb;

CREATE OR REPLACE FUNCTION public.mark_registration_paid(
    p_registration_id uuid,
    p_org_id uuid
)
RETURNS SETOF public.registrations
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.is_org_member(p_org_id) THEN
        RAISE EXCEPTION 'Not authorized to manage this organization';
    END IF;

    RETURN QUERY
    UPDATE public.registrations
    SET payment_status = 'paid',
        payment_details = COALESCE(payment_details, '{}'::jsonb)
            || jsonb_build_object(
                'verifiedAt',
                now(),
                'verifiedBy',
                (SELECT auth.uid())
            )
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status = 'confirmed'
      AND payment_status = 'pending'
      AND payment_method IN ('tithely', 'in_person')
    RETURNING *;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration is not an eligible pending payment';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated, service_role;
