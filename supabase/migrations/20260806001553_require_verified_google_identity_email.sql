-- Trust the email asserted and verified by Google, not only the mutable
-- top-level Auth user email. Supabase does not persist Google's hosted-domain
-- claim, so exact matching on the verified Google identity email is the
-- server-side source of truth.
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
          AND lower(COALESCE(identities.identity_data ->> 'email', ''))
            ~ '^[^@]+@kentmethodist[.]org$'
          AND COALESCE(
            (identities.identity_data ->> 'email_verified')::boolean,
            false
          )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.is_kentmethodist_admin_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_kentmethodist_admin_user(uuid) TO authenticated, service_role;

;
