-- Admin authorization is intentionally enforced in Postgres. The React check is UX only.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_kentmethodist_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS users
    WHERE users.id = p_user_id
      AND users.email_confirmed_at IS NOT NULL
      AND lower(users.email) ~ '^[^@]+@kentmethodist[.]org$'
      AND EXISTS (
        SELECT 1
        FROM auth.identities AS identities
        WHERE identities.user_id = users.id
          AND identities.provider = 'google'
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.is_kentmethodist_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND private.is_kentmethodist_admin_user((SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin')
    );
$$;

CREATE OR REPLACE FUNCTION private.is_org_member_path(p_org_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id::text = p_org_id
        AND user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.can_add_org_member(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.is_kentmethodist_admin()
    AND private.is_kentmethodist_admin_user(p_user_id)
    AND (
      (private.is_org_admin(p_org_id) AND p_role = 'member')
      OR (
        p_user_id = (SELECT auth.uid())
        AND p_role = 'owner'
        AND EXISTS (
          SELECT 1
          FROM public.organizations
          WHERE id = p_org_id
            AND owner_uid = (SELECT auth.uid())
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION private.is_kentmethodist_admin_user(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_kentmethodist_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_org_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_org_member_path(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_add_org_member(uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.is_kentmethodist_admin_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_kentmethodist_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_org_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_org_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_org_member_path(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_add_org_member(uuid, uuid, text) TO authenticated, service_role;

-- Exposed, invoker-rights RPC used only to select the correct admin UX.
CREATE OR REPLACE FUNCTION public.is_kentmethodist_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT private.is_kentmethodist_admin();
$$;

REVOKE ALL ON FUNCTION public.is_kentmethodist_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_kentmethodist_admin() TO authenticated, service_role;

-- Keep the existing public helper interfaces while strengthening their implementation.
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT private.is_org_member(p_org_id);
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT private.is_org_admin(p_org_id);
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid) TO authenticated, service_role;

-- Replace membership policies so users cannot add themselves to arbitrary organizations.
DROP POLICY IF EXISTS org_members_admin_delete ON public.org_members;
DROP POLICY IF EXISTS org_members_admin_insert ON public.org_members;
DROP POLICY IF EXISTS org_members_member_read ON public.org_members;

CREATE POLICY org_members_admin_delete
ON public.org_members
FOR DELETE
TO authenticated
USING (
  role <> 'owner'
  AND (SELECT private.is_org_admin(org_members.org_id))
);

CREATE POLICY org_members_admin_insert
ON public.org_members
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT private.can_add_org_member(org_members.org_id, org_members.user_id, org_members.role))
);

CREATE POLICY org_members_member_read
ON public.org_members
FOR SELECT
TO authenticated
USING ((SELECT private.is_org_member(org_members.org_id)));

-- Only authorized Workspace users can create or administer organizations.
DROP POLICY IF EXISTS organizations_authenticated_insert ON public.organizations;
DROP POLICY IF EXISTS organizations_member_update ON public.organizations;

CREATE POLICY organizations_authenticated_insert
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT private.is_kentmethodist_admin())
  AND owner_uid = (SELECT auth.uid())
);

CREATE POLICY organizations_member_update
ON public.organizations
FOR UPDATE
TO authenticated
USING ((SELECT private.is_org_admin(organizations.id)))
WITH CHECK ((SELECT private.is_org_admin(organizations.id)));

-- Recreate tenant policies with explicit roles and the domain-aware membership helper.
DROP POLICY IF EXISTS events_member_delete ON public.events;
DROP POLICY IF EXISTS events_member_insert ON public.events;
DROP POLICY IF EXISTS events_member_update ON public.events;

CREATE POLICY events_member_delete
ON public.events
FOR DELETE
TO authenticated
USING ((SELECT private.is_org_member(events.org_id)));

CREATE POLICY events_member_insert
ON public.events
FOR INSERT
TO authenticated
WITH CHECK ((SELECT private.is_org_member(events.org_id)));

CREATE POLICY events_member_update
ON public.events
FOR UPDATE
TO authenticated
USING ((SELECT private.is_org_member(events.org_id)))
WITH CHECK ((SELECT private.is_org_member(events.org_id)));

DROP POLICY IF EXISTS registrations_member_update ON public.registrations;
DROP POLICY IF EXISTS registrations_select ON public.registrations;

CREATE POLICY registrations_member_update
ON public.registrations
FOR UPDATE
TO authenticated
USING ((SELECT private.is_org_member(registrations.org_id)))
WITH CHECK ((SELECT private.is_org_member(registrations.org_id)));

CREATE POLICY registrations_select
ON public.registrations
FOR SELECT
TO authenticated
USING ((SELECT private.is_org_member(registrations.org_id)));

DROP POLICY IF EXISTS profiles_segmented ON public.profiles;

CREATE POLICY profiles_segmented
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (
    (SELECT private.is_kentmethodist_admin())
    AND EXISTS (
      SELECT 1
      FROM public.org_members AS current_membership
      JOIN public.org_members AS profile_membership
        ON profile_membership.org_id = current_membership.org_id
      WHERE current_membership.user_id = (SELECT auth.uid())
        AND profile_membership.user_id = profiles.id
    )
  )
);

DROP POLICY IF EXISTS "Org members can delete event images" ON storage.objects;
DROP POLICY IF EXISTS "Org members can update event images" ON storage.objects;
DROP POLICY IF EXISTS "Org members can upload event images" ON storage.objects;

CREATE POLICY "Org members can delete event images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
);

CREATE POLICY "Org members can update event images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
)
WITH CHECK (
  bucket_id = 'event-images'
  AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
);

CREATE POLICY "Org members can upload event images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
);

-- Domain-aware admin RPCs.
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
  IF NOT private.is_org_member(p_org_id) THEN
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

CREATE OR REPLACE FUNCTION public.mark_registration_paid(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS SETOF public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  RETURN QUERY
  UPDATE public.registrations
  SET payment_status = 'paid',
      payment_method = 'in_person_verified',
      payment_details = COALESCE(payment_details, '{}'::jsonb)
        || jsonb_build_object('verifiedAt', now(), 'verifiedBy', (SELECT auth.uid()))
  WHERE id = p_registration_id
    AND org_id = p_org_id
    AND status = 'confirmed'
    AND payment_status = 'pending'
    AND payment_method = 'in_person'
  RETURNING *;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration is not an eligible pending in-person payment';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_smtp_config(
  p_org_id uuid,
  p_host text,
  p_port integer,
  p_user text,
  p_pass text,
  p_from_email text,
  p_from_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_existing_secret_id uuid;
  v_secret_name text;
BEGIN
  IF NOT private.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_secret_name := 'org_smtp_' || p_org_id::text;

  IF p_pass IS NOT NULL AND p_pass <> '' AND p_pass <> '********' THEN
    SELECT id
    INTO v_existing_secret_id
    FROM vault.secrets
    WHERE name = v_secret_name;

    IF v_existing_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_secret_id, p_pass);
    ELSE
      PERFORM vault.create_secret(p_pass, v_secret_name, 'SMTP Password for Organization');
    END IF;
  END IF;

  UPDATE public.organizations
  SET smtp_config = CASE
        WHEN p_host IS NULL OR p_host = '' THEN NULL
        ELSE jsonb_build_object(
          'host', p_host,
          'port', p_port,
          'fromEmail', p_from_email,
          'fromName', p_from_name,
          'auth', jsonb_build_object('user', p_user)
        )
      END,
      updated_at = now()
  WHERE id = p_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_registration(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_registration_paid(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.secure_smtp_config(uuid, text, integer, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_registration(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_registration_paid(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.secure_smtp_config(uuid, text, integer, text, text, text, text) TO authenticated, service_role;

-- Service-only helpers must never be callable through the public Data API.
CREATE OR REPLACE FUNCTION public.get_org_smtp_secret(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'org_smtp_' || p_org_id::text;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payment_status(
  p_registration_id uuid,
  p_payment_status text,
  p_payment_method text,
  p_payment_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  UPDATE public.registrations
  SET payment_status = p_payment_status,
      payment_method = p_payment_method,
      payment_details = p_payment_details
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found: %', p_registration_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_smtp_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_payment_status(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_smtp_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_status(uuid, text, text, jsonb) TO service_role;

-- Trigger-only functions execute through their triggers, not through PostgREST RPC.
REVOKE ALL ON FUNCTION public.handle_new_registration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_registration_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_registration_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_registration_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_registration_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Demo membership remains development-only and now observes the same identity gate.
CREATE OR REPLACE FUNCTION public.join_demo_org()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NOT private.is_kentmethodist_admin() THEN
    RAISE EXCEPTION 'A kentmethodist.org Google Workspace account is required';
  END IF;

  SELECT id
  INTO v_org_id
  FROM public.organizations
  WHERE slug = 'demo-org';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo organization not found';
  END IF;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_org_id, (SELECT auth.uid()), 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'joined', 'orgId', 'demo-org');
END;
$$;

REVOKE ALL ON FUNCTION public.join_demo_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_demo_org() TO authenticated, service_role;
