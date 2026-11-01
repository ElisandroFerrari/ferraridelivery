alter table public.profiles
  add column if not exists neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  add column if not exists city text not null default '' check (char_length(city) <= 100);

create or replace function public.validate_order_delivery_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where user_id = new.user_id
      and length(trim(full_name)) >= 3
      and length(trim(phone)) > 0
      and length(trim(street)) > 0
      and length(trim(street_number)) > 0
      and length(trim(neighborhood)) > 0
      and length(trim(city)) > 0
  ) then
    raise exception using message = 'profile_required', errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_validate_delivery_profile on public.orders;
create trigger orders_validate_delivery_profile before insert on public.orders
for each row execute function public.validate_order_delivery_profile();
