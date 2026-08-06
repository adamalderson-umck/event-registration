-- The registration projection is a cached view of the normalized payment ledger.
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS payment_expected_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS payment_recorded_total numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_payment_paid boolean NOT NULL DEFAULT false;

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_payment_status_check;

CREATE TABLE public.registration_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'check', 'tithely')),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL CHECK (payment_date <= CURRENT_DATE),
  reference_number text,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  void_reason text,
  CONSTRAINT registration_payments_cash_reference_check
    CHECK (payment_method <> 'cash' OR reference_number IS NULL),
  CONSTRAINT registration_payments_non_cash_reference_check
    CHECK (payment_method = 'cash' OR btrim(reference_number) <> ''),
  CONSTRAINT registration_payments_void_metadata_check
    CHECK (
      (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
      OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND btrim(void_reason) <> '')
    )
);

CREATE UNIQUE INDEX registration_payments_active_tithely_reference_org_key
  ON public.registration_payments (org_id, lower(btrim(reference_number)))
  WHERE payment_method = 'tithely' AND voided_at IS NULL;

ALTER TABLE public.registration_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY registration_payments_org_read
ON public.registration_payments
FOR SELECT
TO authenticated
USING ((SELECT private.is_org_member(registration_payments.org_id)));

REVOKE ALL ON TABLE public.registration_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.registration_payments TO authenticated;

-- A historical "paid" value has no payment amount or traceable payment row.
-- Preserve it as a legacy fact rather than fabricating ledger data.
UPDATE public.registrations AS registrations
SET
  legacy_payment_paid = registrations.payment_status = 'paid',
  payment_expected_amount = CASE
    WHEN registrations.payment_status = 'paid' THEN NULL
    WHEN events.payment_enabled AND events.payment_amount > 0 THEN events.payment_amount::numeric(12, 2)
    ELSE NULL
  END,
  payment_recorded_total = 0,
  payment_status = CASE
    WHEN registrations.payment_status = 'paid' THEN 'paid'
    WHEN events.payment_enabled THEN 'pending'
    ELSE 'not_required'
  END
FROM public.events AS events
WHERE events.id = registrations.event_id;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'partial', 'paid'));

CREATE OR REPLACE FUNCTION private.initialize_registration_payment_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_payment_enabled boolean;
  v_payment_amount numeric(12, 2);
BEGIN
  SELECT events.payment_enabled, events.payment_amount
  INTO v_payment_enabled, v_payment_amount
  FROM public.events AS events
  WHERE events.id = NEW.event_id
    AND events.org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event not found for registration payment projection';
  END IF;

  NEW.payment_expected_amount := CASE
    WHEN v_payment_enabled AND v_payment_amount > 0 THEN v_payment_amount
    ELSE NULL
  END;
  NEW.payment_recorded_total := 0;
  NEW.legacy_payment_paid := false;
  NEW.payment_status := CASE
    WHEN v_payment_enabled THEN 'pending'
    ELSE 'not_required'
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_registration_payment_projection ON public.registrations;
CREATE TRIGGER initialize_registration_payment_projection
BEFORE INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.initialize_registration_payment_projection();

CREATE OR REPLACE FUNCTION private.guard_registration_payment_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF pg_catalog.current_setting('app.payment_projection_write', true) IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Registration payment projection columns are managed by the payment ledger';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_registration_payment_projection ON public.registrations;
CREATE TRIGGER guard_registration_payment_projection
BEFORE UPDATE OF payment_expected_amount, payment_recorded_total, payment_status, legacy_payment_paid
ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.guard_registration_payment_projection();

CREATE OR REPLACE FUNCTION private.refresh_registration_payment_projection(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_payment_enabled boolean;
  v_recorded_total numeric(12, 2);
  v_next_payment_status text;
BEGIN
  SELECT registrations.*, events.payment_enabled
  INTO v_registration, v_payment_enabled
  FROM public.registrations AS registrations
  JOIN public.events AS events
    ON events.id = registrations.event_id
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
    AND events.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  SELECT COALESCE(SUM(registration_payments.amount), 0)::numeric(12, 2)
  INTO v_recorded_total
  FROM public.registration_payments AS registration_payments
  WHERE registration_payments.registration_id = p_registration_id
    AND registration_payments.org_id = p_org_id
    AND registration_payments.voided_at IS NULL;

  IF NOT v_payment_enabled THEN
    v_next_payment_status := 'not_required';
  ELSIF v_registration.legacy_payment_paid THEN
    v_next_payment_status := 'paid';
  ELSIF v_recorded_total = 0 THEN
    v_next_payment_status := 'pending';
  ELSIF v_registration.payment_expected_amount IS NULL THEN
    v_next_payment_status := 'paid';
  ELSIF v_recorded_total < v_registration.payment_expected_amount THEN
    v_next_payment_status := 'partial';
  ELSE
    v_next_payment_status := 'paid';
  END IF;

  PERFORM pg_catalog.set_config('app.payment_projection_write', 'allowed', true);
  UPDATE public.registrations AS registrations
  SET payment_recorded_total = v_recorded_total,
      payment_status = v_next_payment_status
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  RETURNING registrations.* INTO v_registration;
  PERFORM pg_catalog.set_config('app.payment_projection_write', '', true);

  RETURN v_registration;
END;
$$;

CREATE OR REPLACE FUNCTION private.registration_payment_result(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(
    'registration', pg_catalog.to_jsonb(registrations),
    'payments', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(registration_payments)
        ORDER BY registration_payments.payment_date DESC, registration_payments.created_at DESC
      )
      FROM public.registration_payments AS registration_payments
      WHERE registration_payments.registration_id = registrations.id
        AND registration_payments.org_id = p_org_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_registration_payment(
  p_registration_id uuid,
  p_org_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_payment_date date,
  p_reference_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_payment_enabled boolean;
  v_payment_method text;
  v_reference_number text;
  v_amount numeric(12, 2);
  v_recorded_total numeric(12, 2);
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  v_payment_method := pg_catalog.lower(pg_catalog.btrim(p_payment_method));
  v_reference_number := NULLIF(pg_catalog.btrim(p_reference_number), '');
  v_amount := pg_catalog.round(p_amount, 2);

  IF v_payment_method IS NULL OR v_payment_method NOT IN ('cash', 'check', 'tithely') THEN
    RAISE EXCEPTION 'Payment method must be cash, check, or tithely';
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_payment_date IS NULL OR p_payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Payment date cannot be in the future';
  END IF;

  IF v_payment_method = 'cash' AND v_reference_number IS NOT NULL THEN
    RAISE EXCEPTION 'Cash payments must not include a reference number';
  ELSIF v_payment_method = 'check' AND v_reference_number IS NULL THEN
    RAISE EXCEPTION 'Check payments require a reference number';
  ELSIF v_payment_method = 'tithely' AND v_reference_number IS NULL THEN
    RAISE EXCEPTION 'Tithe.ly payments require a reference number';
  END IF;

  SELECT registrations.*, events.payment_enabled
  INTO v_registration, v_payment_enabled
  FROM public.registrations AS registrations
  JOIN public.events AS events
    ON events.id = registrations.event_id
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
    AND events.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  IF v_registration.status <> 'confirmed' OR NOT v_payment_enabled THEN
    RAISE EXCEPTION 'Registration is not eligible to receive a payment';
  END IF;

  IF v_registration.legacy_payment_paid THEN
    RAISE EXCEPTION 'Legacy paid registrations cannot receive ledger payments';
  END IF;

  SELECT COALESCE(SUM(registration_payments.amount), 0)::numeric(12, 2)
  INTO v_recorded_total
  FROM public.registration_payments AS registration_payments
  WHERE registration_payments.registration_id = p_registration_id
    AND registration_payments.org_id = p_org_id
    AND registration_payments.voided_at IS NULL;

  IF v_registration.payment_expected_amount IS NOT NULL
    AND v_recorded_total + v_amount > v_registration.payment_expected_amount THEN
    RAISE EXCEPTION 'Payment would exceed the expected amount';
  END IF;

  BEGIN
    INSERT INTO public.registration_payments (
      registration_id,
      org_id,
      payment_method,
      amount,
      payment_date,
      reference_number,
      recorded_by
    )
    VALUES (
      p_registration_id,
      p_org_id,
      v_payment_method,
      v_amount,
      p_payment_date,
      v_reference_number,
      (SELECT auth.uid())
    );
  EXCEPTION
    WHEN unique_violation THEN
      IF v_payment_method = 'tithely' THEN
        RAISE EXCEPTION 'A Tithe.ly payment with this transaction reference already exists for this organization';
      END IF;
      RAISE;
  END;

  PERFORM private.refresh_registration_payment_projection(p_registration_id, p_org_id);
  RETURN private.registration_payment_result(p_registration_id, p_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.void_registration_payment(
  p_payment_id uuid,
  p_registration_id uuid,
  p_org_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_payment public.registration_payments%ROWTYPE;
  v_reason text;
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  v_reason := NULLIF(pg_catalog.btrim(p_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Void reason is required';
  END IF;

  -- Match the record RPC's lock order: registration before ledger row.
  SELECT registrations.*
  INTO v_registration
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  SELECT registration_payments.*
  INTO v_payment
  FROM public.registration_payments AS registration_payments
  WHERE registration_payments.id = p_payment_id
    AND registration_payments.registration_id = p_registration_id
    AND registration_payments.org_id = p_org_id
  FOR UPDATE OF registration_payments;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment has already been voided';
  END IF;

  UPDATE public.registration_payments AS registration_payments
  SET voided_at = pg_catalog.now(),
      voided_by = (SELECT auth.uid()),
      void_reason = v_reason
  WHERE registration_payments.id = p_payment_id;

  PERFORM private.refresh_registration_payment_projection(p_registration_id, p_org_id);
  RETURN private.registration_payment_result(p_registration_id, p_org_id);
END;
$$;

REVOKE ALL ON FUNCTION private.initialize_registration_payment_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_registration_payment_projection() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.refresh_registration_payment_projection(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.registration_payment_result(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_registration_payment(uuid, uuid, text, numeric, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_registration_payment(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_registration_payment(uuid, uuid, text, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_registration_payment(uuid, uuid, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_registration_paid(uuid, uuid);
