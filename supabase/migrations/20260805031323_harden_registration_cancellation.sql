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
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.org_members
        WHERE org_id = p_org_id
          AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Not authorized to manage this organization';
    END IF;

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
$$;

REVOKE ALL ON FUNCTION public.cancel_registration(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_registration(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_registration(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_registration_cancellation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_registration_cancellation() FROM anon;
REVOKE ALL ON FUNCTION public.handle_registration_cancellation() FROM authenticated;;
