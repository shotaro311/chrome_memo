-- Add thumbnail support for memos (private Storage bucket + signed URL)

-- 1) DB: add thumbnail path column
ALTER TABLE public.memos
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- 2) Storage: create private bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('memo-thumbnails', 'memo-thumbnails', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

-- 3) Storage policies (idempotent via drop + create)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can upload their own memo thumbnails" ON storage.objects;
CREATE POLICY "Users can upload their own memo thumbnails"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'memo-thumbnails' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can view their own memo thumbnails" ON storage.objects;
CREATE POLICY "Users can view their own memo thumbnails"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'memo-thumbnails' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can delete their own memo thumbnails" ON storage.objects;
CREATE POLICY "Users can delete their own memo thumbnails"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'memo-thumbnails' AND auth.uid() = owner);

DROP POLICY IF EXISTS "Users can update their own memo thumbnails" ON storage.objects;
CREATE POLICY "Users can update their own memo thumbnails"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'memo-thumbnails' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'memo-thumbnails' AND auth.uid() = owner);
