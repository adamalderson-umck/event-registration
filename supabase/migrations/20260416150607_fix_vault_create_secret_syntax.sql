CREATE OR REPLACE FUNCTION public.secure_smtp_config(p_org_id uuid, p_host text, p_port integer, p_user text, p_pass text, p_from_email text, p_from_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret_id UUID;
  v_existing_secret_id UUID;
  v_secret_name TEXT;
  v_uid UUID;
BEGIN
  v_uid := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM org_members WHERE org_id = p_org_id AND user_id = v_uid AND role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'Not authorized (uid: %)', v_uid;
  END IF;

  v_secret_name := 'org_smtp_' || p_org_id::text;

  IF p_pass IS NOT NULL AND p_pass != '' AND p_pass != '********' THEN
    SELECT id INTO v_existing_secret_id FROM vault.secrets WHERE name = v_secret_name;
    IF v_existing_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_secret_id, p_pass);
    ELSE
      v_secret_id := vault.create_secret(p_pass, v_secret_name, 'SMTP Password for Organization');
    END IF;
  END IF;

  UPDATE organizations SET
    smtp_config = CASE
      WHEN p_host IS NULL OR p_host = '' THEN NULL
      ELSE
        jsonb_build_object(
          'host', p_host,
          'port', p_port,
          'fromEmail', p_from_email,
          'fromName', p_from_name,
          'auth', jsonb_build_object('user', p_user)
        )
    END,
    updated_at = NOW()
  WHERE id = p_org_id;

END;
$function$;;
