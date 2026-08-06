-- Supabase Postgres Best Practices: RLS Performance Optimization
-- This wraps all function calls (like is_org_member and auth.uid()) into scalar subqueries
-- This forces Postgres to cache the static return value per-query instead of evaluating it per-row,
-- which scales 10x-100x faster on large tables.

DROP POLICY IF EXISTS "registrations_select" ON public.registrations;
CREATE POLICY "registrations_select" ON public.registrations FOR SELECT USING (
  (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "registrations_member_update" ON public.registrations;
CREATE POLICY "registrations_member_update" ON public.registrations FOR UPDATE USING (
  (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "events_member_insert" ON public.events;
CREATE POLICY "events_member_insert" ON public.events FOR INSERT WITH CHECK (
  (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "events_member_update" ON public.events;
CREATE POLICY "events_member_update" ON public.events FOR UPDATE USING (
  (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "events_member_delete" ON public.events;
CREATE POLICY "events_member_delete" ON public.events FOR DELETE USING (
  (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "org_members_admin_delete" ON public.org_members;
CREATE POLICY "org_members_admin_delete" ON public.org_members FOR DELETE USING (
  (SELECT is_org_admin(org_id))
);

DROP POLICY IF EXISTS "organizations_member_update" ON public.organizations;
CREATE POLICY "organizations_member_update" ON public.organizations FOR UPDATE USING (
  (SELECT is_org_admin(id))
);

DROP POLICY IF EXISTS "org_members_member_read" ON public.org_members;
CREATE POLICY "org_members_member_read" ON public.org_members FOR SELECT USING (
  user_id = (SELECT auth.uid()) OR (SELECT is_org_member(org_id))
);

DROP POLICY IF EXISTS "org_members_admin_insert" ON public.org_members;
CREATE POLICY "org_members_admin_insert" ON public.org_members FOR INSERT WITH CHECK (
  user_id = (SELECT auth.uid()) OR (SELECT is_org_admin(org_id))
);

DROP POLICY IF EXISTS "profiles_segmented" ON public.profiles;
CREATE POLICY "profiles_segmented" ON public.profiles FOR SELECT USING (
  id = (SELECT auth.uid()) OR
  EXISTS (
    SELECT 1 FROM org_members om1
    JOIN org_members om2 ON om1.org_id = om2.org_id
    WHERE om1.user_id = (SELECT auth.uid()) AND om2.user_id = profiles.id
  )
);
;
