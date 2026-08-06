-- Optimize RLS helper functions to use (select auth.uid()) initplan pattern
-- This prevents per-row re-evaluation of auth.uid()

-- Recreate is_org_member with initplan optimization
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id
      AND user_id = (select auth.uid())
  );
$$;

-- Recreate is_org_admin with initplan optimization
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id
      AND user_id = (select auth.uid())
      AND role IN ('owner', 'admin')
  );
$$;

-- Fix direct auth.uid() references in policies

-- organizations: authenticated insert
DROP POLICY IF EXISTS "organizations_authenticated_insert" ON public.organizations;
CREATE POLICY "organizations_authenticated_insert" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) IS NOT NULL);

-- org_members: admin insert
DROP POLICY IF EXISTS "org_members_admin_insert" ON public.org_members;
CREATE POLICY "org_members_admin_insert" ON public.org_members
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (select auth.uid())) OR is_org_admin(org_id));

-- org_members: member read
DROP POLICY IF EXISTS "org_members_member_read" ON public.org_members;
CREATE POLICY "org_members_member_read" ON public.org_members
  FOR SELECT TO authenticated
  USING ((user_id = (select auth.uid())) OR is_org_member(org_id));

-- profiles: insert own
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = id);

-- profiles: update own
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((select auth.uid()) = id);;
