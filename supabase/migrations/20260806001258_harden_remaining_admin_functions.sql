-- These two RPCs only modify rows already allowed by RLS and do not need
-- definer privileges. The SMTP and demo RPCs retain definer rights because
-- they need Vault/bootstrap access and perform explicit authorization checks.
ALTER FUNCTION public.cancel_registration(uuid, uuid) SECURITY INVOKER;
ALTER FUNCTION public.mark_registration_paid(uuid, uuid) SECURITY INVOKER;

-- This trigger is not callable by API roles, but a fixed path protects its
-- definer execution from object-shadowing attacks.
ALTER FUNCTION public.handle_registration_deletion() SET search_path TO '';
