
-- Helper function for the Edge Function to fetch SMTP password from vault
-- using the service role (bypasses RLS).
CREATE OR REPLACE FUNCTION public.get_org_smtp_secret(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_secret TEXT;
  v_secret_name TEXT;
BEGIN
  v_secret_name := 'org_smtp_' || p_org_id::text;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = v_secret_name;
  RETURN v_secret;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_smtp_secret(uuid) TO service_role;
;
