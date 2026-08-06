-- Drop and recreate update_payment_status with correct signature
DROP FUNCTION IF EXISTS update_payment_status(UUID, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION update_payment_status(
  p_registration_id UUID,
  p_payment_status TEXT,
  p_payment_method TEXT,
  p_payment_details JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE registrations
  SET
    payment_status = p_payment_status,
    payment_method = p_payment_method,
    payment_details = p_payment_details
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found: %', p_registration_id;
  END IF;
END;
$$;;
