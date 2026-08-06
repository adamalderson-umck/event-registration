-- Add missing index on registrations.org_id (foreign key)
CREATE INDEX IF NOT EXISTS idx_registrations_org_id ON public.registrations (org_id);;
