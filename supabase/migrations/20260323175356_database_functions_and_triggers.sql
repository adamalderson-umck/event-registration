
-- ═══════════════════════════════════════════════════════════════
-- handle_new_registration: Replaces Firebase onRegistrationCreated
-- Atomically determines status (confirmed/waitlisted) and updates counters
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_new_registration()
RETURNS TRIGGER AS $$
DECLARE
  v_event RECORD;
  v_new_status TEXT;
BEGIN
  -- Get event data
  SELECT capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM events
    WHERE id = NEW.event_id
    FOR UPDATE;  -- Lock the event row for atomic counter update

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found: %', NEW.event_id;
  END IF;

  -- Determine status based on capacity
  IF v_event.capacity IS NOT NULL AND v_event.registration_count >= v_event.capacity THEN
    IF v_event.waitlist_enabled THEN
      v_new_status := 'waitlisted';
    ELSE
      v_new_status := 'confirmed';  -- Over capacity but no waitlist
    END IF;
  ELSE
    v_new_status := 'confirmed';
  END IF;

  -- Update the registration status
  NEW.status := v_new_status;

  -- Increment the appropriate counter
  IF v_new_status = 'waitlisted' THEN
    UPDATE events
      SET waitlist_count = waitlist_count + 1
      WHERE id = NEW.event_id;
  ELSE
    UPDATE events
      SET registration_count = registration_count + 1
      WHERE id = NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: BEFORE INSERT so we can modify the NEW row's status
CREATE TRIGGER trg_new_registration
  BEFORE INSERT ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_registration();

-- ═══════════════════════════════════════════════════════════════
-- handle_registration_cancellation: Replaces Firebase onRegistrationUpdated
-- Decrements counters and auto-promotes from waitlist
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_registration_cancellation()
RETURNS TRIGGER AS $$
DECLARE
  v_event RECORD;
  v_promoted RECORD;
BEGIN
  -- Only handle transitions TO 'cancelled'
  IF OLD.status = 'cancelled' OR NEW.status != 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Lock the event row
  SELECT id, capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM events
    WHERE id = NEW.event_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Set cancelled_at timestamp
  NEW.cancelled_at := now();

  -- Decrement appropriate counter
  IF OLD.status = 'waitlisted' THEN
    UPDATE events
      SET waitlist_count = GREATEST(waitlist_count - 1, 0)
      WHERE id = NEW.event_id;
  ELSE
    UPDATE events
      SET registration_count = GREATEST(registration_count - 1, 0)
      WHERE id = NEW.event_id;

    -- Promote from waitlist if applicable
    IF v_event.waitlist_enabled AND v_event.waitlist_count > 0 THEN
      -- Find oldest waitlisted registration for this event
      SELECT id INTO v_promoted
        FROM registrations
        WHERE event_id = NEW.event_id
          AND status = 'waitlisted'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE;

      IF FOUND THEN
        -- Promote
        UPDATE registrations
          SET status = 'confirmed', promoted_at = now()
          WHERE id = v_promoted.id;

        -- Update counters: +1 confirmed, -1 waitlist
        UPDATE events
          SET registration_count = registration_count + 1,
              waitlist_count = GREATEST(waitlist_count - 1, 0)
          WHERE id = NEW.event_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: BEFORE UPDATE so we can modify the NEW row
CREATE TRIGGER trg_registration_cancellation
  BEFORE UPDATE ON registrations
  FOR EACH ROW
  EXECUTE FUNCTION handle_registration_cancellation();

-- ═══════════════════════════════════════════════════════════════
-- updated_at trigger for organizations and events
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- join_demo_org: RPC replacing Firebase joinDemoOrg callable
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION join_demo_org()
RETURNS JSONB AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;

  SELECT id INTO v_org_id
    FROM organizations
    WHERE slug = 'demo-org';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo organization not found. Run seed script first.';
  END IF;

  -- Insert member (ignore if already exists)
  INSERT INTO org_members (org_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'member')
    ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'joined', 'orgId', 'demo-org');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
;
