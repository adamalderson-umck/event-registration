-- The composite foreign key already guarantees that every payment belongs to
-- the supplied registration and organization. Keeping the additional
-- registration_id-only foreign key gives PostgREST two relationship paths and
-- makes registration_payments embeds ambiguous.
ALTER TABLE public.registration_payments
  DROP CONSTRAINT IF EXISTS registration_payments_registration_id_fkey;
