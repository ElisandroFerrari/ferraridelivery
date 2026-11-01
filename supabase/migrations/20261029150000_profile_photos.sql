alter table public.profiles
  add column if not exists avatar_path text check (char_length(avatar_path) <= 120);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_photos_read_own" on storage.objects;
create policy "profile_photos_read_own" on storage.objects
for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "profile_photos_insert_own" on storage.objects;
create policy "profile_photos_insert_own" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "profile_photos_update_own" on storage.objects;
create policy "profile_photos_update_own" on storage.objects
for update to authenticated
using (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/avatar.jpg'
)
with check (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/avatar.jpg'
);

drop policy if exists "profile_photos_delete_own" on storage.objects;
create policy "profile_photos_delete_own" on storage.objects
for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and name = (select auth.uid())::text || '/avatar.jpg'
);
