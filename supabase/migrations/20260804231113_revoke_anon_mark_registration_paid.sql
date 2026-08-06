REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated;;
