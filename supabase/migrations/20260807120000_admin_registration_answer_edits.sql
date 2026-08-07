CREATE TABLE public.registration_answer_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  editor_user_id uuid NOT NULL,
  editor_display_name text NOT NULL,
  changes jsonb NOT NULL CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) > 0
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX registration_answer_edits_registration_created_idx
  ON public.registration_answer_edits (registration_id, created_at DESC);

CREATE INDEX registration_answer_edits_org_idx
  ON public.registration_answer_edits (org_id);

ALTER TABLE public.registration_answer_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY registration_answer_edits_org_read
  ON public.registration_answer_edits
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_org_member(registration_answer_edits.org_id)));

REVOKE ALL ON TABLE public.registration_answer_edits
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.registration_answer_edits TO authenticated;
GRANT ALL ON TABLE public.registration_answer_edits TO service_role;

CREATE OR REPLACE FUNCTION public.apply_registration_answer_edit(
  p_registration_id uuid,
  p_org_id uuid,
  p_event_id uuid,
  p_editor_user_id uuid,
  p_editor_display_name text,
  p_expected_form_data jsonb,
  p_new_form_data jsonb,
  p_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_edit public.registration_answer_edits%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_expected_form_data) <> 'object'
     OR jsonb_typeof(p_new_form_data) <> 'object'
     OR jsonb_typeof(p_changes) <> 'array'
     OR jsonb_array_length(p_changes) = 0
     OR nullif(pg_catalog.btrim(p_editor_display_name), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;

  SELECT registrations.*
  INTO v_registration
  FROM public.registrations AS registrations
  WHERE registrations.id = p_registration_id
    AND registrations.org_id = p_org_id
    AND registrations.event_id = p_event_id
  FOR UPDATE OF registrations;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  IF v_registration.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'registration_cancelled'
    );
  END IF;

  IF v_registration.form_data IS DISTINCT FROM p_expected_form_data THEN
    RETURN jsonb_build_object('ok', false, 'code', 'edit_conflict');
  END IF;

  UPDATE public.registrations
  SET form_data = p_new_form_data
  WHERE id = p_registration_id
  RETURNING * INTO v_registration;

  INSERT INTO public.registration_answer_edits (
    registration_id,
    org_id,
    event_id,
    editor_user_id,
    editor_display_name,
    changes
  ) VALUES (
    p_registration_id,
    p_org_id,
    p_event_id,
    p_editor_user_id,
    pg_catalog.btrim(p_editor_display_name),
    p_changes
  )
  RETURNING * INTO v_edit;

  RETURN jsonb_build_object(
    'ok', true,
    'registration', to_jsonb(v_registration),
    'edit', to_jsonb(v_edit)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_registration_answer_edit(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_registration_answer_edit(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb, jsonb
) TO service_role;
