CREATE OR REPLACE FUNCTION secure_smtp_config(
  p_org_id UUID,
  p_host TEXT,
  p_port INT,
  p_user TEXT,
  p_pass TEXT,
  p_from_email TEXT,
  p_from_name TEXT
) RETURNS void AS $$
DECLARE
  v_secret_id UUID;
  v_existing_secret_id UUID;
  v_secret_name TEXT;
BEGIN
  -- Check permission (must be owner or admin of org)
  IF NOT EXISTS (SELECT 1 FROM org_members WHERE org_id = p_org_id AND user_id = auth.uid() AND role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_secret_name := 'org_smtp_' || p_org_id::text;

  -- Insert/Update secret in vault if password is provided
  IF p_pass IS NOT NULL AND p_pass != '' AND p_pass != '********' THEN
    SELECT id INTO v_existing_secret_id FROM vault.secrets WHERE name = v_secret_name;
    IF v_existing_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_secret_id, p_pass);
    ELSE
      SELECT id INTO v_secret_id FROM vault.create_secret(p_pass, v_secret_name, 'SMTP Password for Organization');
    END IF;
  END IF;

  -- Update organizations table with JSON config devoid of the actual password
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
$$ LANGUAGE plpgsql SECURITY DEFINER;;
