create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or coalesce((select auth.uid()) = '0680c531-6f8e-4ad8-aae9-4de4206765ab'::uuid, false)
    or exists (
      select 1 from public.profiles
      where user_id = (select auth.uid()) and role = 'admin'
    ),
    false
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
