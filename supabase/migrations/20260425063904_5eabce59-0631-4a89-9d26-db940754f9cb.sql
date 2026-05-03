-- Public read policy was too broad (allowed listing). Drop it.
drop policy if exists "public read avatars" on storage.objects;

-- Public can still GET individual files by URL because the bucket itself is public.
-- We don't need a SELECT policy for that — bucket public flag handles direct file access.
-- Authenticated users can still read their own avatars for profile editing.
create policy "users read own avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);