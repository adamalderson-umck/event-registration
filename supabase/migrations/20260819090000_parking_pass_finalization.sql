ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_by uuid,
  ADD COLUMN IF NOT EXISTS parking_pass_finalized_by_name text;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_parking_pass_finalization_metadata_check
  CHECK (
    (
      parking_pass_finalized_at IS NULL
      AND parking_pass_finalized_by IS NULL
      AND parking_pass_finalized_by_name IS NULL
    )
    OR (
      parking_pass_finalized_at IS NOT NULL
      AND parking_pass_finalized_by_name IS NOT NULL
      AND pg_catalog.btrim(parking_pass_finalized_by_name) <> ''
    )
  );

CREATE TABLE public.parking_pass_finalization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('finalized', 'reopened')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_display_name text NOT NULL CHECK (pg_catalog.btrim(actor_display_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT parking_pass_finalization_events_registration_org_fkey
    FOREIGN KEY (registration_id, org_id)
    REFERENCES public.registrations(id, org_id) ON DELETE RESTRICT
);

CREATE INDEX parking_pass_finalization_events_registration_created_idx
  ON public.parking_pass_finalization_events (registration_id, created_at DESC);

CREATE INDEX parking_pass_finalization_events_org_idx
  ON public.parking_pass_finalization_events (org_id);

ALTER TABLE public.parking_pass_finalization_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY parking_pass_finalization_events_org_read
  ON public.parking_pass_finalization_events
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(parking_pass_finalization_events.org_id)));

REVOKE ALL ON TABLE public.parking_pass_finalization_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.parking_pass_finalization_events TO authenticated;
GRANT ALL ON TABLE public.parking_pass_finalization_events TO service_role;

CREATE OR REPLACE FUNCTION private.initialize_parking_pass_finalization_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.parking_pass_finalized_at := NULL;
  NEW.parking_pass_finalized_by := NULL;
  NEW.parking_pass_finalized_by_name := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER initialize_parking_pass_finalization_projection
BEFORE INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.initialize_parking_pass_finalization_projection();

CREATE OR REPLACE FUNCTION private.guard_parking_pass_finalization_projection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF pg_catalog.current_setting('app.parking_pass_finalization_write', true)
      IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION 'Parking pass finalization is managed by its transition function';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_parking_pass_finalization_projection
BEFORE UPDATE OF
  parking_pass_finalized_at,
  parking_pass_finalized_by,
  parking_pass_finalized_by_name
ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION private.guard_parking_pass_finalization_projection();

CREATE OR REPLACE FUNCTION private.transition_parking_pass_finalization(
  p_registration_id uuid,
  p_org_id uuid,
  p_finalized boolean,
  p_expected_finalized_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_audit public.parking_pass_finalization_events%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_name text;
  v_event_type text;
  v_action text;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;

  IF NOT private.is_org_member(p_org_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  IF p_finalized IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;

  SELECT registrations.*
  INTO v_registration
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT events.event_type
  INTO v_event_type
  FROM public.events AS events
  WHERE events.id = v_registration.event_id
    AND events.org_id = p_org_id;

  IF NOT FOUND OR v_event_type IS DISTINCT FROM 'parking' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_parking');
  END IF;

  SELECT NULLIF(pg_catalog.btrim(profiles.display_name), '')
  INTO v_actor_name
  FROM public.profiles AS profiles
  WHERE profiles.id = v_actor_id;
  v_actor_name := COALESCE(v_actor_name, v_actor_id::text);

  IF p_finalized THEN
    IF v_registration.parking_pass_finalized_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'finalization_conflict');
    END IF;
    IF v_registration.status <> 'confirmed'
       OR v_registration.payment_status <> 'paid' THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_eligible');
    END IF;
    v_action := 'finalized';
  ELSE
    IF v_registration.parking_pass_finalized_at IS NULL
       OR v_registration.parking_pass_finalized_at IS DISTINCT FROM p_expected_finalized_at THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'finalization_conflict');
    END IF;
    v_action := 'reopened';
  END IF;

  PERFORM pg_catalog.set_config('app.parking_pass_finalization_write', 'allowed', true);
  UPDATE public.registrations AS registrations
  SET parking_pass_finalized_at = CASE WHEN p_finalized THEN pg_catalog.now() ELSE NULL END,
      parking_pass_finalized_by = CASE WHEN p_finalized THEN v_actor_id ELSE NULL END,
      parking_pass_finalized_by_name = CASE WHEN p_finalized THEN v_actor_name ELSE NULL END
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
  RETURNING registrations.* INTO v_registration;
  PERFORM pg_catalog.set_config('app.parking_pass_finalization_write', '', true);

  INSERT INTO public.parking_pass_finalization_events (
    registration_id,
    org_id,
    action,
    actor_user_id,
    actor_display_name
  ) VALUES (
    p_registration_id,
    p_org_id,
    v_action,
    v_actor_id,
    v_actor_name
  )
  RETURNING * INTO v_audit;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'registration', pg_catalog.to_jsonb(v_registration),
    'event', pg_catalog.to_jsonb(v_audit)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_parking_pass(
  p_registration_id uuid,
  p_org_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.transition_parking_pass_finalization(
    p_registration_id,
    p_org_id,
    true,
    NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.undo_parking_pass_finalization(
  p_registration_id uuid,
  p_org_id uuid,
  p_expected_finalized_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.transition_parking_pass_finalization(
    p_registration_id,
    p_org_id,
    false,
    p_expected_finalized_at
  );
$$;

REVOKE ALL ON FUNCTION private.guard_parking_pass_finalization_projection()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.initialize_parking_pass_finalization_projection()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.transition_parking_pass_finalization(uuid, uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_parking_pass(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_parking_pass_finalization(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_parking_pass(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_parking_pass_finalization(uuid, uuid, timestamptz) TO authenticated, service_role;
