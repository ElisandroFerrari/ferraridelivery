alter table public.profiles
  add column if not exists role text not null default 'customer';

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

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null and not public.is_admin() then
      new.role := 'customer';
    end if;
  elsif new.role is distinct from old.role
    and (select auth.uid()) is not null
    and not public.is_admin() then
    raise exception using message = 'profile_role_change_forbidden', errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before insert or update of role on public.profiles
for each row execute function public.protect_profile_role();
