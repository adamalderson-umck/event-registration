
-- Step 1: Create a security-definer function to check org membership
-- without triggering RLS on org_members (bypasses RLS by design).
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

-- Step 2: Drop the old recursive policies
DROP POLICY IF EXISTS org_members_member_read ON org_members;
DROP POLICY IF EXISTS org_members_admin_insert ON org_members;
DROP POLICY IF EXISTS org_members_admin_delete ON org_members;

-- Step 3: Recreate policies using the security-definer functions
-- SELECT: users can see rows in orgs they belong to
CREATE POLICY org_members_member_read ON org_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_org_member(org_id)
  );

-- INSERT: user can insert themselves, or an admin/owner can add others
CREATE POLICY org_members_admin_insert ON org_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_org_admin(org_id)
  );

-- DELETE: only admins/owners can remove members
CREATE POLICY org_members_admin_delete ON org_members
  FOR DELETE
  USING (
    public.is_org_admin(org_id)
  );
;
