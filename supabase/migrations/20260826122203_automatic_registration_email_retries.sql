CREATE OR REPLACE FUNCTION private.registration_lifecycle_delivery(
  p_registration_id uuid,
  p_status text,
  p_created_at timestamptz,
  p_promoted_at timestamptz,
  p_cancelled_at timestamptz
)
RETURNS TABLE(kind text, delivery_key text)
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT lifecycle.kind,
         lifecycle.kind || ':' || p_registration_id::text || ':' ||
           (pg_catalog.to_jsonb(lifecycle.occurrence) #>> '{}')
  FROM (
    SELECT
      CASE
        WHEN p_status = 'cancelled' AND p_cancelled_at IS NOT NULL
          THEN 'registration_cancellation'
        WHEN p_status = 'waitlisted'
          THEN 'registration_waitlist'
        WHEN p_status = 'confirmed' AND p_promoted_at IS NOT NULL
          THEN 'waitlist_promotion'
        WHEN p_status = 'confirmed'
          THEN 'registration_confirmation'
        ELSE NULL
      END AS kind,
      CASE
        WHEN p_status = 'cancelled' THEN p_cancelled_at
        WHEN p_status = 'confirmed' AND p_promoted_at IS NOT NULL
          THEN p_promoted_at
        WHEN p_status IN ('confirmed', 'waitlisted') THEN p_created_at
        ELSE NULL
      END AS occurrence
  ) lifecycle
  WHERE lifecycle.kind IS NOT NULL
    AND lifecycle.occurrence IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_registration_email_delivery_statuses(
  p_org_id uuid,
  p_event_id uuid
)
RETURNS TABLE (
  registration_id uuid,
  delivery_id uuid,
  kind text,
  state text,
  attempt_count integer,
  last_error_code text,
  attempted_at timestamptz,
  sent_at timestamptz,
  next_retry_at timestamptz,
  exhausted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF coalesce((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    IF (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF NOT private.is_org_member(p_org_id) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    d.id,
    lifecycle.kind,
    d.state,
    d.attempt_count,
    d.last_error_code,
    d.attempted_at,
    d.sent_at,
    CASE
      WHEN d.state = 'pending' AND d.attempt_count < 4 THEN
        d.attempted_at + GREATEST(
          CASE d.attempt_count
            WHEN 1 THEN interval '5 minutes'
            WHEN 2 THEN interval '30 minutes'
            WHEN 3 THEN interval '2 hours'
          END,
          interval '15 minutes'
        )
      WHEN d.state = 'failed' AND d.attempt_count < 4 THEN
        d.attempted_at + CASE d.attempt_count
          WHEN 1 THEN interval '5 minutes'
          WHEN 2 THEN interval '30 minutes'
          WHEN 3 THEN interval '2 hours'
        END
      ELSE NULL
    END,
    coalesce(d.state = 'failed' AND d.attempt_count >= 4, false)
  FROM public.registrations AS r
  CROSS JOIN LATERAL private.registration_lifecycle_delivery(
    r.id,
    r.status,
    r.created_at,
    r.promoted_at,
    r.cancelled_at
  ) AS lifecycle
  LEFT JOIN public.email_deliveries AS d
    ON d.registration_id = r.id
   AND d.org_id = r.org_id
   AND d.event_id = r.event_id
   AND d.kind = lifecycle.kind
   AND d.delivery_key = lifecycle.delivery_key
  WHERE r.org_id = p_org_id
    AND r.event_id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_registration_email_delivery(
  p_org_id uuid,
  p_registration_id uuid,
  p_delivery_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_registration public.registrations%ROWTYPE;
  v_delivery public.email_deliveries%ROWTYPE;
  v_lifecycle record;
  v_project_url text;
  v_automation_secret text;
BEGIN
  IF coalesce((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    IF (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    IF NOT private.is_org_member(p_org_id) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT r.*
  INTO v_registration
  FROM public.registrations AS r
  WHERE r.id = p_registration_id
    AND r.org_id = p_org_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'registration_not_found'
    );
  END IF;

  SELECT d.*
  INTO v_delivery
  FROM public.email_deliveries AS d
  WHERE d.id = p_delivery_id
    AND d.registration_id = p_registration_id
    AND d.org_id = p_org_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'delivery_not_found'
    );
  END IF;

  SELECT lifecycle.*
  INTO v_lifecycle
  FROM private.registration_lifecycle_delivery(
    v_registration.id,
    v_registration.status,
    v_registration.created_at,
    v_registration.promoted_at,
    v_registration.cancelled_at
  ) AS lifecycle
  JOIN public.email_deliveries AS d
    ON d.id = p_delivery_id
   AND d.registration_id = v_registration.id
   AND d.kind = lifecycle.kind
   AND d.delivery_key = lifecycle.delivery_key;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'not_applicable'
    );
  END IF;

  IF v_delivery.state <> 'failed' OR v_delivery.attempt_count < 4 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'not_exhausted'
    );
  END IF;

  SELECT
    pg_catalog.max(decrypted_secret) FILTER (WHERE name = 'project_url'),
    pg_catalog.max(decrypted_secret) FILTER (
      WHERE name = 'email_automation_secret'
    )
  INTO v_project_url, v_automation_secret
  FROM vault.decrypted_secrets;

  IF v_project_url IS NULL OR coalesce(v_automation_secret, '') = '' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'code', 'configuration_unavailable'
    );
  END IF;

  PERFORM net.http_post(
    url := v_project_url || '/functions/v1/send-registration-email',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', v_automation_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'type', 'RETRY',
      'delivery_id', p_delivery_id
    ),
    timeout_milliseconds := 30000
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'code', 'queued');
END;
$$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'retry-registration-lifecycle-emails';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

SELECT cron.schedule(
  'retry-registration-lifecycle-emails',
  '*/5 * * * *',
  $job$
  WITH applicable AS (
    SELECT d.id, d.state, d.attempt_count, d.attempted_at
    FROM public.email_deliveries AS d
    JOIN public.registrations AS r ON r.id = d.registration_id
    CROSS JOIN LATERAL private.registration_lifecycle_delivery(
      r.id,
      r.status,
      r.created_at,
      r.promoted_at,
      r.cancelled_at
    ) AS lifecycle
    WHERE d.kind = lifecycle.kind
      AND d.delivery_key = lifecycle.delivery_key
      AND d.kind IN (
        'registration_confirmation',
        'registration_waitlist',
        'waitlist_promotion',
        'registration_cancellation'
      )
      AND d.state IN ('failed', 'pending')
      AND d.attempt_count < 4
  ), due AS (
    SELECT id
    FROM applicable
    WHERE attempted_at + CASE
      WHEN state = 'pending' THEN GREATEST(
        CASE attempt_count
          WHEN 1 THEN interval '5 minutes'
          WHEN 2 THEN interval '30 minutes'
          WHEN 3 THEN interval '2 hours'
        END,
        interval '15 minutes'
      )
      ELSE CASE attempt_count
        WHEN 1 THEN interval '5 minutes'
        WHEN 2 THEN interval '30 minutes'
        WHEN 3 THEN interval '2 hours'
      END
    END <= pg_catalog.now()
    ORDER BY attempted_at
    LIMIT 10
  ), configuration AS (
    SELECT
      pg_catalog.max(decrypted_secret) FILTER (
        WHERE name = 'project_url'
      ) AS project_url,
      pg_catalog.max(decrypted_secret) FILTER (
        WHERE name = 'email_automation_secret'
      ) AS automation_secret
    FROM vault.decrypted_secrets
  )
  SELECT net.http_post(
    url := configuration.project_url ||
      '/functions/v1/send-registration-email',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-email-automation-secret', configuration.automation_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'type', 'RETRY',
      'delivery_id', due.id
    ),
    timeout_milliseconds := 30000
  )
  FROM due
  CROSS JOIN configuration
  WHERE configuration.project_url IS NOT NULL
    AND coalesce(configuration.automation_secret, '') <> '';
  $job$
);

REVOKE ALL ON FUNCTION private.registration_lifecycle_delivery(
  uuid, text, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.registration_lifecycle_delivery(
  uuid, text, timestamptz, timestamptz, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.get_registration_email_delivery_statuses(
  uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_registration_email_delivery_statuses(
  uuid, uuid
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.retry_registration_email_delivery(
  uuid, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_registration_email_delivery(
  uuid, uuid, uuid
) TO authenticated, service_role;
