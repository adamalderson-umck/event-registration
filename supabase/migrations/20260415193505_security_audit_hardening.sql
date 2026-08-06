-- 1. Secure Registrations PII
DROP POLICY IF EXISTS "registrations_select" ON public.registrations;
CREATE POLICY "registrations_select" ON public.registrations FOR SELECT USING (
  is_org_member(org_id)
);

-- 2. Segment Profiles
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "profiles_segmented" ON public.profiles FOR SELECT USING (
  id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM org_members om1
    JOIN org_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = auth.uid() AND om2.user_id = profiles.id
  )
);

-- 3. Harden RPC search_path
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
  v_uid UUID;
BEGIN
  v_uid := (current_setting('request.jwt.claim.sub', true))::uuid;

  IF NOT EXISTS (SELECT 1 FROM org_members WHERE org_id = p_org_id AND user_id = v_uid AND role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'Not authorized (uid: %)', v_uid;
  END IF;

  v_secret_name := 'org_smtp_' || p_org_id::text;

  IF p_pass IS NOT NULL AND p_pass != '' AND p_pass != '********' THEN
    SELECT id INTO v_existing_secret_id FROM vault.secrets WHERE name = v_secret_name;
    IF v_existing_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_secret_id, p_pass);
    ELSE
      SELECT id INTO v_secret_id FROM vault.create_secret(p_pass, v_secret_name, 'SMTP Password for Organization');
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. Fix Storage Listing Leak
DROP POLICY IF EXISTS "Public read access for event images" ON storage.objects;
;
