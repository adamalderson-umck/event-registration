


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "private"."can_add_org_member"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT private.is_kentmethodist_admin()
    AND private.is_kentmethodist_admin_user(p_user_id)
    AND (
      (private.is_org_admin(p_org_id) AND p_role = 'member')
      OR (
        p_user_id = (SELECT auth.uid())
        AND p_role = 'owner'
        AND EXISTS (
          SELECT 1
          FROM public.organizations
          WHERE id = p_org_id
            AND owner_uid = (SELECT auth.uid())
        )
      )
    );
$$;


ALTER FUNCTION "private"."can_add_org_member"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_kentmethodist_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND private.is_kentmethodist_admin_user((SELECT auth.uid()));
$$;


ALTER FUNCTION "private"."is_kentmethodist_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_kentmethodist_admin_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users AS users
    WHERE users.id = p_user_id
      AND users.email_confirmed_at IS NOT NULL
      AND lower(users.email) ~ '^[^@]+@kentmethodist[.]org$'
      AND EXISTS (
        SELECT 1
        FROM auth.identities AS identities
        WHERE identities.user_id = users.id
          AND identities.provider = 'google'
          AND lower(COALESCE(identities.identity_data ->> 'email', ''))
            ~ '^[^@]+@kentmethodist[.]org$'
          AND COALESCE(
            (identities.identity_data ->> 'email_verified')::boolean,
            false
          )
      )
  );
$_$;


ALTER FUNCTION "private"."is_kentmethodist_admin_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_org_admin"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin')
    );
$$;


ALTER FUNCTION "private"."is_org_admin"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_org_member"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id = p_org_id
        AND user_id = (SELECT auth.uid())
    );
$$;


ALTER FUNCTION "private"."is_org_member"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_org_member_path"("p_org_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT private.is_kentmethodist_admin()
    AND EXISTS (
      SELECT 1
      FROM public.org_members
      WHERE org_id::text = p_org_id
        AND user_id = (SELECT auth.uid())
    );
$$;


ALTER FUNCTION "private"."is_org_member_path"("p_org_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_registration"("p_registration_id" "uuid", "p_org_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  UPDATE public.registrations
  SET status = 'cancelled'
  WHERE id = p_registration_id
    AND org_id = p_org_id
    AND status <> 'cancelled';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Registration not found or already cancelled'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."cancel_registration"("p_registration_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_org_smtp_secret"("p_org_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'org_smtp_' || p_org_id::text;

  RETURN v_secret;
END;
$$;


ALTER FUNCTION "public"."get_org_smtp_secret"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_registration"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_new_registration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_registration_cancellation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
    v_event record;
    v_promoted record;
BEGIN
    IF OLD.status = 'cancelled' OR NEW.status != 'cancelled' THEN
        RETURN NEW;
    END IF;

    SELECT id, capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM public.events
    WHERE id = NEW.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    NEW.cancelled_at := now();

    IF OLD.status = 'waitlisted' THEN
        UPDATE public.events
        SET waitlist_count = GREATEST(waitlist_count - 1, 0)
        WHERE id = NEW.event_id;
    ELSE
        UPDATE public.events
        SET registration_count = GREATEST(registration_count - 1, 0)
        WHERE id = NEW.event_id;

        IF v_event.waitlist_enabled AND v_event.waitlist_count > 0 THEN
            SELECT id
            INTO v_promoted
            FROM public.registrations
            WHERE event_id = NEW.event_id
              AND status = 'waitlisted'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE;

            IF FOUND THEN
                UPDATE public.registrations
                SET status = 'confirmed',
                    promoted_at = now()
                WHERE id = v_promoted.id;

                UPDATE public.events
                SET registration_count = registration_count + 1,
                    waitlist_count = GREATEST(waitlist_count - 1, 0)
                WHERE id = NEW.event_id;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_registration_cancellation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_registration_deletion"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_event RECORD;
  v_promoted RECORD;
BEGIN
  -- Lock the event row
  SELECT id, capacity, waitlist_enabled, registration_count, waitlist_count
    INTO v_event
    FROM public.events
    WHERE id = OLD.event_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN OLD;
  END IF;

  -- Decrement appropriate counter
  IF OLD.status = 'waitlisted' THEN
    UPDATE public.events
      SET waitlist_count = GREATEST(waitlist_count - 1, 0)
      WHERE id = OLD.event_id;
  ELSIF OLD.status = 'confirmed' THEN
    UPDATE public.events
      SET registration_count = GREATEST(registration_count - 1, 0)
      WHERE id = OLD.event_id;

    -- Promote from waitlist if applicable
    IF v_event.waitlist_enabled AND v_event.waitlist_count > 0 THEN
      -- Find oldest waitlisted registration for this event
      SELECT id INTO v_promoted
        FROM public.registrations
        WHERE event_id = OLD.event_id
          AND status = 'waitlisted'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE;

      IF FOUND THEN
        -- Promote
        UPDATE public.registrations
          SET status = 'confirmed', promoted_at = now()
          WHERE id = v_promoted.id;

        -- Update counters: +1 confirmed, -1 waitlist
        UPDATE public.events
          SET registration_count = registration_count + 1,
              waitlist_count = GREATEST(waitlist_count - 1, 0)
          WHERE id = OLD.event_id;
      END IF;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."handle_registration_deletion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_kentmethodist_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT private.is_kentmethodist_admin();
$$;


ALTER FUNCTION "public"."is_kentmethodist_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT private.is_org_admin(p_org_id);
$$;


ALTER FUNCTION "public"."is_org_admin"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT private.is_org_member(p_org_id);
$$;


ALTER FUNCTION "public"."is_org_member"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_demo_org"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NOT private.is_kentmethodist_admin() THEN
    RAISE EXCEPTION 'A kentmethodist.org Google Workspace account is required';
  END IF;

  SELECT id
  INTO v_org_id
  FROM public.organizations
  WHERE slug = 'demo-org';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demo organization not found';
  END IF;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_org_id, (SELECT auth.uid()), 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'joined', 'orgId', 'demo-org');
END;
$$;


ALTER FUNCTION "public"."join_demo_org"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "form_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "payment_status" "text" DEFAULT 'not_required'::"text",
    "payment_method" "text",
    "payment_details" "jsonb",
    "signature_record" "jsonb",
    "cancelled_at" timestamp with time zone,
    "promoted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "signature_records" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "registrations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'waitlisted'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."registrations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_registration_paid"("p_registration_id" "uuid", "p_org_id" "uuid") RETURNS SETOF "public"."registrations"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  IF NOT private.is_org_member(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this organization';
  END IF;

  RETURN QUERY
  UPDATE public.registrations
  SET payment_status = 'paid',
      payment_method = 'in_person_verified',
      payment_details = COALESCE(payment_details, '{}'::jsonb)
        || jsonb_build_object('verifiedAt', now(), 'verifiedBy', (SELECT auth.uid()))
  WHERE id = p_registration_id
    AND org_id = p_org_id
    AND status = 'confirmed'
    AND payment_status = 'pending'
    AND payment_method = 'in_person'
  RETURNING *;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration is not an eligible pending in-person payment';
  END IF;
END;
$$;


ALTER FUNCTION "public"."mark_registration_paid"("p_registration_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_registration_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/send-registration-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'registrations',
      'record', to_jsonb(NEW),
      'old_record', NULL
    )
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_registration_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_registration_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Only fire for status changes to avoid unnecessary calls
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
             || '/functions/v1/send-registration-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
      ),
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'registrations',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_registration_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."secure_smtp_config"("p_org_id" "uuid", "p_host" "text", "p_port" integer, "p_user" "text", "p_pass" "text", "p_from_email" "text", "p_from_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_existing_secret_id uuid;
  v_secret_name text;
BEGIN
  IF NOT private.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_secret_name := 'org_smtp_' || p_org_id::text;

  IF p_pass IS NOT NULL AND p_pass <> '' AND p_pass <> '********' THEN
    SELECT id
    INTO v_existing_secret_id
    FROM vault.secrets
    WHERE name = v_secret_name;

    IF v_existing_secret_id IS NOT NULL THEN
      PERFORM vault.update_secret(v_existing_secret_id, p_pass);
    ELSE
      PERFORM vault.create_secret(p_pass, v_secret_name, 'SMTP Password for Organization');
    END IF;
  END IF;

  UPDATE public.organizations
  SET smtp_config = CASE
        WHEN p_host IS NULL OR p_host = '' THEN NULL
        ELSE jsonb_build_object(
          'host', p_host,
          'port', p_port,
          'fromEmail', p_from_email,
          'fromName', p_from_name,
          'auth', jsonb_build_object('user', p_user)
        )
      END,
      updated_at = now()
  WHERE id = p_org_id;
END;
$$;


ALTER FUNCTION "public"."secure_smtp_config"("p_org_id" "uuid", "p_host" "text", "p_port" integer, "p_user" "text", "p_pass" "text", "p_from_email" "text", "p_from_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_payment_status"("p_registration_id" "uuid", "p_payment_status" "text", "p_payment_method" "text", "p_payment_details" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
BEGIN
  UPDATE public.registrations
  SET payment_status = p_payment_status,
      payment_method = p_payment_method,
      payment_details = p_payment_details
  WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found: %', p_registration_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."update_payment_status"("p_registration_id" "uuid", "p_payment_status" "text", "p_payment_method" "text", "p_payment_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "location" "text" DEFAULT ''::"text",
    "start_date" timestamp with time zone,
    "end_date" timestamp with time zone,
    "status" "text" DEFAULT 'draft'::"text",
    "capacity" integer,
    "waitlist_enabled" boolean DEFAULT false,
    "payment_enabled" boolean DEFAULT false,
    "payment_amount" numeric(10,2),
    "form_fields" "jsonb" DEFAULT '[]'::"jsonb",
    "notifications" "jsonb" DEFAULT '{}'::"jsonb",
    "waiver_enabled" boolean DEFAULT false,
    "waiver_title" "text" DEFAULT ''::"text",
    "waiver_content" "text" DEFAULT ''::"text",
    "waiver_content_hash" "text" DEFAULT ''::"text",
    "registration_count" integer DEFAULT 0,
    "waitlist_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "registration_close_date" timestamp with time zone,
    "reminder_hours_before" integer,
    "reminder_sent_at" timestamp with time zone,
    "header_image_url" "text",
    "theme" "jsonb",
    "slug" "text",
    "waivers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "event_type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "allow_in_person_payment" boolean DEFAULT false NOT NULL,
    CONSTRAINT "events_event_type_check" CHECK (("event_type" = ANY (ARRAY['standard'::"text", 'parking'::"text"]))),
    CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "org_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "owner_uid" "uuid" NOT NULL,
    "smtp_config" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "default_header_image_url" "text",
    "default_theme" "jsonb"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "avatar_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."registrations"
    ADD CONSTRAINT "registrations_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "events_org_id_slug_idx" ON "public"."events" USING "btree" ("org_id", "slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "idx_events_org_id" ON "public"."events" USING "btree" ("org_id");



CREATE INDEX "idx_events_status" ON "public"."events" USING "btree" ("status");



CREATE INDEX "idx_org_members_user_id" ON "public"."org_members" USING "btree" ("user_id");



CREATE INDEX "idx_organizations_slug" ON "public"."organizations" USING "btree" ("slug");



CREATE INDEX "idx_registrations_event_id" ON "public"."registrations" USING "btree" ("event_id");



CREATE INDEX "idx_registrations_org_id" ON "public"."registrations" USING "btree" ("org_id");



CREATE INDEX "idx_registrations_status" ON "public"."registrations" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "on_registration_insert" AFTER INSERT ON "public"."registrations" FOR EACH ROW EXECUTE FUNCTION "public"."notify_registration_insert"();



CREATE OR REPLACE TRIGGER "on_registration_update" AFTER UPDATE ON "public"."registrations" FOR EACH ROW EXECUTE FUNCTION "public"."notify_registration_update"();



CREATE OR REPLACE TRIGGER "trg_events_updated_at" BEFORE UPDATE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_new_registration" BEFORE INSERT ON "public"."registrations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_registration"();



CREATE OR REPLACE TRIGGER "trg_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "trg_registration_cancellation" BEFORE UPDATE ON "public"."registrations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_registration_cancellation"();



CREATE OR REPLACE TRIGGER "trg_registration_deletion" AFTER DELETE ON "public"."registrations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_registration_deletion"();



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registrations"
    ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registrations"
    ADD CONSTRAINT "registrations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_member_delete" ON "public"."events" FOR DELETE TO "authenticated" USING (( SELECT "private"."is_org_member"("events"."org_id") AS "is_org_member"));



CREATE POLICY "events_member_insert" ON "public"."events" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."is_org_member"("events"."org_id") AS "is_org_member"));



CREATE POLICY "events_member_update" ON "public"."events" FOR UPDATE TO "authenticated" USING (( SELECT "private"."is_org_member"("events"."org_id") AS "is_org_member")) WITH CHECK (( SELECT "private"."is_org_member"("events"."org_id") AS "is_org_member"));



CREATE POLICY "events_public_read" ON "public"."events" FOR SELECT USING (true);



ALTER TABLE "public"."org_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_members_admin_delete" ON "public"."org_members" FOR DELETE TO "authenticated" USING ((("role" <> 'owner'::"text") AND ( SELECT "private"."is_org_admin"("org_members"."org_id") AS "is_org_admin")));



CREATE POLICY "org_members_admin_insert" ON "public"."org_members" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."can_add_org_member"("org_members"."org_id", "org_members"."user_id", "org_members"."role") AS "can_add_org_member"));



CREATE POLICY "org_members_member_read" ON "public"."org_members" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_org_member"("org_members"."org_id") AS "is_org_member"));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_authenticated_insert" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."is_kentmethodist_admin"() AS "is_kentmethodist_admin") AND ("owner_uid" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "organizations_member_update" ON "public"."organizations" FOR UPDATE TO "authenticated" USING (( SELECT "private"."is_org_admin"("organizations"."id") AS "is_org_admin")) WITH CHECK (( SELECT "private"."is_org_admin"("organizations"."id") AS "is_org_admin"));



CREATE POLICY "organizations_public_read" ON "public"."organizations" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_segmented" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "private"."is_kentmethodist_admin"() AS "is_kentmethodist_admin") AND (EXISTS ( SELECT 1
   FROM ("public"."org_members" "current_membership"
     JOIN "public"."org_members" "profile_membership" ON (("profile_membership"."org_id" = "current_membership"."org_id")))
  WHERE (("current_membership"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profile_membership"."user_id" = "profiles"."id")))))));



ALTER TABLE "public"."registrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "registrations_insert_valid" ON "public"."registrations" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."events"
  WHERE (("events"."id" = "registrations"."event_id") AND ("events"."org_id" = "registrations"."org_id") AND ("events"."status" = 'active'::"text")))));



CREATE POLICY "registrations_member_update" ON "public"."registrations" FOR UPDATE TO "authenticated" USING (( SELECT "private"."is_org_member"("registrations"."org_id") AS "is_org_member")) WITH CHECK (( SELECT "private"."is_org_member"("registrations"."org_id") AS "is_org_member"));



CREATE POLICY "registrations_select" ON "public"."registrations" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_org_member"("registrations"."org_id") AS "is_org_member"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."registrations";









GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "private"."can_add_org_member"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_add_org_member"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "private"."can_add_org_member"("p_org_id" "uuid", "p_user_id" "uuid", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_kentmethodist_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_kentmethodist_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_kentmethodist_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_kentmethodist_admin_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_kentmethodist_admin_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_kentmethodist_admin_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_org_admin"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_org_admin"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_org_admin"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_org_member"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_org_member"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_org_member"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."is_org_member_path"("p_org_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_org_member_path"("p_org_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "private"."is_org_member_path"("p_org_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_registration"("p_registration_id" "uuid", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_registration"("p_registration_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_registration"("p_registration_id" "uuid", "p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_org_smtp_secret"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_org_smtp_secret"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_registration"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_registration"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_registration_cancellation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_registration_cancellation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_registration_deletion"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_registration_deletion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_kentmethodist_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_kentmethodist_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_kentmethodist_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_demo_org"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_demo_org"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_demo_org"() TO "service_role";



GRANT ALL ON TABLE "public"."registrations" TO "anon";
GRANT ALL ON TABLE "public"."registrations" TO "authenticated";
GRANT ALL ON TABLE "public"."registrations" TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_registration_paid"("p_registration_id" "uuid", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_registration_paid"("p_registration_id" "uuid", "p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_registration_paid"("p_registration_id" "uuid", "p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_registration_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_registration_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_registration_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_registration_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."secure_smtp_config"("p_org_id" "uuid", "p_host" "text", "p_port" integer, "p_user" "text", "p_pass" "text", "p_from_email" "text", "p_from_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."secure_smtp_config"("p_org_id" "uuid", "p_host" "text", "p_port" integer, "p_user" "text", "p_pass" "text", "p_from_email" "text", "p_from_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."secure_smtp_config"("p_org_id" "uuid", "p_host" "text", "p_port" integer, "p_user" "text", "p_pass" "text", "p_from_email" "text", "p_from_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_payment_status"("p_registration_id" "uuid", "p_payment_status" "text", "p_payment_method" "text", "p_payment_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_payment_status"("p_registration_id" "uuid", "p_payment_status" "text", "p_payment_method" "text", "p_payment_details" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";
























GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."org_members" TO "anon";
GRANT ALL ON TABLE "public"."org_members" TO "authenticated";
GRANT ALL ON TABLE "public"."org_members" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- Configuration and managed-schema objects omitted by the schema-only dump.

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Org members can upload event images" ON storage.objects;
CREATE POLICY "Org members can upload event images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-images'
    AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "Org members can update event images" ON storage.objects;
CREATE POLICY "Org members can update event images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'event-images'
    AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
  )
  WITH CHECK (
    bucket_id = 'event-images'
    AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS "Org members can delete event images" ON storage.objects;
CREATE POLICY "Org members can delete event images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'event-images'
    AND (SELECT private.is_org_member_path((storage.foldername(name))[1]))
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    PERFORM vault.create_secret('http://host.docker.internal:54321', 'project_url');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'anon_key') THEN
    PERFORM vault.create_secret('local-anon-key-not-configured', 'anon_key');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-digest') THEN
    PERFORM cron.schedule(
      'weekly-digest',
      '0 13 * * 1',
      $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
               || '/functions/v1/weekly-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key')
        ),
        body := '{"scheduled": true}'::jsonb
      ) AS request_id;
      $job$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-event-reminders') THEN
    PERFORM cron.schedule(
      'send-event-reminders',
      '0 * * * *',
      $job$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/send-event-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := '{}'::jsonb
      ) AS request_id;
      $job$
    );
  END IF;
END;
$$;
