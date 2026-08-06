CREATE OR REPLACE FUNCTION public.cancel_registration(
    p_registration_id uuid,
    p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
    UPDATE public.registrations
    SET status = 'cancelled'
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status != 'cancelled';

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Registration not found or already cancelled'
        );
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;;
