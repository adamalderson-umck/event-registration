DROP POLICY IF EXISTS "registrations_insert_valid" ON public.registrations;
REVOKE INSERT ON TABLE public.registrations FROM anon;

DROP POLICY IF EXISTS "registrations_authenticated_member_insert" ON public.registrations;
CREATE POLICY "registrations_authenticated_member_insert"
ON public.registrations
FOR INSERT
TO authenticated
WITH CHECK (
    (SELECT private.is_org_member(registrations.org_id))
    AND EXISTS (
        SELECT 1
        FROM public.events
        WHERE events.id = registrations.event_id
          AND events.org_id = registrations.org_id
          AND events.status = 'active'
    )
);
