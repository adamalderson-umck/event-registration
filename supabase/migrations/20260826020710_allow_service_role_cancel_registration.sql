CREATE OR REPLACE FUNCTION public.cancel_registration(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF current_user <> 'service_role' AND NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE id = p_registration_id
    AND org_id = p_org_id
    AND status <> 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Registration not found or already cancelled'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_registration(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_registration(uuid, uuid) TO authenticated, service_role;
