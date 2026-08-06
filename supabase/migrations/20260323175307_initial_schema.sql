
-- Organizations
CREATE TABLE organizations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_uid UUID NOT NULL,
  smtp_config JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Org members (junction table replaces Firestore array)
CREATE TABLE org_members (
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- Events
CREATE TABLE events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  capacity INT,
  waitlist_enabled BOOLEAN DEFAULT FALSE,
  payment_enabled BOOLEAN DEFAULT FALSE,
  payment_amount DECIMAL(10,2),
  form_fields JSONB DEFAULT '[]',
  notifications JSONB DEFAULT '{}',
  waiver_enabled BOOLEAN DEFAULT FALSE,
  waiver_title TEXT DEFAULT '',
  waiver_content TEXT DEFAULT '',
  waiver_content_hash TEXT DEFAULT '',
  registration_count INT DEFAULT 0,
  waitlist_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Registrations
CREATE TABLE registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  form_data JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','waitlisted','cancelled')),
  payment_status TEXT DEFAULT 'not_required',
  payment_method TEXT,
  payment_details JSONB,
  signature_record JSONB,
  cancelled_at TIMESTAMPTZ,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_events_org_id ON events(org_id);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_registrations_event_id ON registrations(event_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_org_members_user_id ON org_members(user_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);
;
