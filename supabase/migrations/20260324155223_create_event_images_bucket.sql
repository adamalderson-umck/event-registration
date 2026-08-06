-- Create public storage bucket for event header images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
);

-- RLS: Anyone can view (public bucket)
CREATE POLICY "Public read access for event images"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-images');

-- RLS: Authenticated org members can upload
CREATE POLICY "Org members can upload event images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.user_id = auth.uid()
    AND org_members.org_id::text = (storage.foldername(name))[1]
  )
);

-- RLS: Authenticated org members can update/replace images
CREATE POLICY "Org members can update event images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.user_id = auth.uid()
    AND org_members.org_id::text = (storage.foldername(name))[1]
  )
);

-- RLS: Authenticated org members can delete images
CREATE POLICY "Org members can delete event images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.user_id = auth.uid()
    AND org_members.org_id::text = (storage.foldername(name))[1]
  )
);;
