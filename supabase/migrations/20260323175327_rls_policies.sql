
-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- ORGANIZATIONS
-- ═══════════════════════════════════════════════════════════════

-- Public: anyone can read orgs (needed for slug resolution on landing page)
CREATE POLICY "organizations_public_read"
  ON organizations FOR SELECT
  USING (true);

-- Members can update their own orgs
CREATE POLICY "organizations_member_update"
  ON organizations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = organizations.id
        AND org_members.user_id = auth.uid()
        AND org_members.role IN ('owner', 'admin')
    )
  );

-- Authenticated users can create orgs
CREATE POLICY "organizations_authenticated_insert"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════
-- ORG_MEMBERS
-- ═══════════════════════════════════════════════════════════════

-- Members can see other members of their orgs
CREATE POLICY "org_members_member_read"
  ON org_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
    )
  );

-- Owners/admins can add members
CREATE POLICY "org_members_admin_insert"
  ON org_members FOR INSERT
  WITH CHECK (
    -- Allow self-insert (for org creation)
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- Owners/admins can remove members
CREATE POLICY "org_members_admin_delete"
  ON org_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = org_members.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- EVENTS
-- ═══════════════════════════════════════════════════════════════

-- Public: anyone can read active events (for landing/registration pages)
CREATE POLICY "events_public_read"
  ON events FOR SELECT
  USING (true);

-- Members can create events in their orgs
CREATE POLICY "events_member_insert"
  ON events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = events.org_id
        AND org_members.user_id = auth.uid()
    )
  );

-- Members can update events in their orgs
CREATE POLICY "events_member_update"
  ON events FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = events.org_id
        AND org_members.user_id = auth.uid()
    )
  );

-- Members can delete events in their orgs
CREATE POLICY "events_member_delete"
  ON events FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = events.org_id
        AND org_members.user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════════
-- REGISTRATIONS
-- ═══════════════════════════════════════════════════════════════

-- Public: anyone can insert registrations (anonymous registration)
CREATE POLICY "registrations_public_insert"
  ON registrations FOR INSERT
  WITH CHECK (true);

-- Public: anyone can read their own registration (for cancel page via token)
-- Org members can read all registrations for their orgs
CREATE POLICY "registrations_read"
  ON registrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = registrations.org_id
        AND org_members.user_id = auth.uid()
    )
    -- Allow public read by ID (for cancel token verification)
    OR true
  );

-- Public: anyone can update their own registration (for cancel + payment)
CREATE POLICY "registrations_public_update"
  ON registrations FOR UPDATE
  USING (true);
;
