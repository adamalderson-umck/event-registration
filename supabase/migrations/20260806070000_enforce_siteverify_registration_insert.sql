DROP POLICY IF EXISTS "registrations_insert_valid" ON public.registrations;
REVOKE INSERT ON TABLE public.registrations FROM anon, authenticated;
