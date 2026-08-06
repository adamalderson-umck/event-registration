
-- Update organizations policy to use helper
DROP POLICY IF EXISTS organizations_member_update ON organizations;
CREATE POLICY organizations_member_update ON organizations
  FOR UPDATE
  USING (public.is_org_admin(id));

-- Update events policies to use helper
DROP POLICY IF EXISTS events_member_insert ON events;
CREATE POLICY events_member_insert ON events
  FOR INSERT
  WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS events_member_update ON events;
CREATE POLICY events_member_update ON events
  FOR UPDATE
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS events_member_delete ON events;
CREATE POLICY events_member_delete ON events
  FOR DELETE
  USING (public.is_org_member(org_id));

-- Update registrations policy to use helper
DROP POLICY IF EXISTS registrations_member_update ON registrations;
CREATE POLICY registrations_member_update ON registrations
  FOR UPDATE
  USING (public.is_org_member(org_id));
;
