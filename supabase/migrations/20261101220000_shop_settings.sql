create table if not exists public.store_settings (
  id boolean primary key default true check (id),
  opening_time time not null default '11:00',
  closing_time time not null default '14:00',
  lunch_open boolean not null default true,
  lunch_start time not null default '12:00',
  lunch_end time not null default '13:00',
  evening_enabled boolean not null default false,
  evening_start time not null default '18:00',
  evening_end time not null default '22:00',
  manual_open boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint store_settings_day_hours_check check (opening_time <> closing_time),
  constraint store_settings_lunch_hours_check check (lunch_start <> lunch_end),
  constraint store_settings_evening_hours_check check (evening_start <> evening_end)
);

insert into public.store_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.store_settings enable row level security;
drop policy if exists "store_settings_public_read" on public.store_settings;
create policy "store_settings_public_read" on public.store_settings
for select to anon, authenticated
using (true);
drop policy if exists "store_settings_admin_manage" on public.store_settings;
create policy "store_settings_admin_manage" on public.store_settings
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

grant select on public.store_settings to anon, authenticated;
grant update on public.store_settings to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'store_settings'
    ) then
    alter publication supabase_realtime add table public.store_settings;
  end if;
end;
$$;
