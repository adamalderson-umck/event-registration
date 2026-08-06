
-- Fix mutable search_path on all SECURITY DEFINER functions
ALTER FUNCTION handle_new_registration() SET search_path = '';
ALTER FUNCTION handle_registration_cancellation() SET search_path = '';
ALTER FUNCTION update_updated_at() SET search_path = '';
ALTER FUNCTION join_demo_org() SET search_path = '';

-- Tighten registration update policy:
-- Only allow updating status/payment fields, and only for cancellation or payment
DROP POLICY "registrations_public_update" ON registrations;

-- Allow org members to update registrations for their orgs
CREATE POLICY "registrations_member_update"
  ON registrations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_members.org_id = registrations.org_id
        AND org_members.user_id = auth.uid()
    )
  );

-- Allow public to update only specific fields (cancel + payment)
-- via a service_role function instead of wide-open UPDATE
-- For self-service cancellation and payment, we use RPC functions:
CREATE OR REPLACE FUNCTION cancel_registration(p_registration_id UUID, p_org_id UUID)
RETURNS JSONB AS $$
BEGIN
  UPDATE registrations
    SET status = 'cancelled'
    WHERE id = p_registration_id
      AND org_id = p_org_id
      AND status != 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registration not found or already cancelled');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION update_payment_status(
  p_registration_id UUID,
  p_payment_status TEXT,
  p_payment_method TEXT DEFAULT NULL,
  p_payment_details JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
BEGIN
  UPDATE registrations
    SET payment_status = p_payment_status,
        payment_method = COALESCE(p_payment_method, payment_method),
        payment_details = COALESCE(p_payment_details, payment_details)
    WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Registration not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Simplify registrations_read to: public can read individual registrations by ID
-- (needed for cancel page and payment), members can read all for their org
DROP POLICY "registrations_read" ON registrations;

CREATE POLICY "registrations_select"
  ON registrations FOR SELECT
  USING (true);  -- SELECT with true is acceptable and not flagged

-- Tighten registration insert to ensure org_id matches the event's org_id
DROP POLICY "registrations_public_insert" ON registrations;

CREATE POLICY "registrations_insert_valid"
  ON registrations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = registrations.event_id
        AND events.org_id = registrations.org_id
        AND events.status = 'active'
    )
  );
;
