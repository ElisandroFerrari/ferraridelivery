create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  phone text not null default '' check (char_length(phone) <= 24),
  street text not null default '' check (char_length(street) <= 160),
  street_number text not null default '' check (char_length(street_number) <= 20),
  complement text not null default '' check (char_length(complement) <= 100),
  neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  city text not null default '' check (char_length(city) <= 100),
  role text not null default 'customer',
  whatsapp_opt_in boolean not null default false,
  avatar_path text check (char_length(avatar_path) <= 120),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists avatar_path text check (char_length(avatar_path) <= 120),
  add column if not exists neighborhood text not null default '' check (char_length(neighborhood) <= 100),
  add column if not exists city text not null default '' check (char_length(city) <= 100),
  add column if not exists role text not null default 'customer';

create table if not exists public.menu_categories (
  key text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 60),
  tag text check (char_length(tag) <= 40),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.menu_categories (key, name, tag, sort_order)
values
  ('a-la-minuta', 'Alaminutas', 'Itens principais', 0),
  ('lanches', 'Lanches', 'Feitos na hora', 1),
  ('bebidas', 'Bebidas', 'Para acompanhar', 2),
  ('porcoes', 'Porções', 'Para compartilhar', 3),
  ('sobremesas', 'Sobremesas', 'Um toque doce', 4)
on conflict (key) do nothing;

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

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  category text not null references public.menu_categories(key),
  description text check (char_length(description) <= 500),
  price numeric(10, 2) not null check (price > 0),
  promotional_price numeric(10, 2) check (promotional_price is null or (promotional_price > 0 and promotional_price < price)),
  stock integer check (stock is null or stock >= 0),
  complements jsonb not null default '[]'::jsonb check (jsonb_typeof(complements) = 'array'),
  image_url text check (char_length(image_url) <= 2048),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_name_key unique (category, name)
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  price numeric(10, 2) not null check (price > 0),
  image_url text check (char_length(image_url) <= 240),
  description text check (char_length(description) <= 240),
  is_active boolean not null default true,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.validate_promotion_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product_price numeric(10, 2);
begin
  select coalesce(promotional_price, price) into v_product_price from public.products where id = new.product_id;
  if not found or new.price > v_product_price then
    raise exception using message = 'promotion_price_invalid', errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists promotions_validate_price on public.promotions;
create trigger promotions_validate_price before insert or update of product_id, price on public.promotions
for each row execute function public.validate_promotion_price();

create or replace function public.validate_product_price_against_promotions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.promotional_price, new.price) > new.price or exists (
    select 1 from public.promotions
    where product_id = new.id and is_active and price > coalesce(new.promotional_price, new.price)
  ) then
    raise exception using message = 'disable_or_update_promotions_first', errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists products_validate_promotions on public.products;
create trigger products_validate_promotions before update of price, promotional_price on public.products
for each row execute function public.validate_product_price_against_promotions();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  status text not null default 'recebido'
    check (status in ('recebido', 'em_andamento', 'saiu_para_entrega', 'pronto', 'cancelado')),
  total numeric(10, 2) not null check (total > 0),
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 50),
  unit_price numeric(10, 2) not null check (unit_price > 0),
  line_total numeric(10, 2) not null check (line_total > 0)
);

create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('order_created', 'order_status_changed')),
  order_id uuid not null references public.orders (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists products_category_active_name_idx
  on public.products (category, name) where is_active;
create index if not exists orders_scheduled_for_idx on public.orders (scheduled_for) where scheduled_for is not null;
create index if not exists promotions_active_idx
  on public.promotions (created_at desc) where is_active;
create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, phone)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 24)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

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

alter table public.profiles enable row level security;
alter table public.menu_categories enable row level security;
alter table public.store_settings enable row level security;
alter table public.products enable row level security;
alter table public.promotions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.notification_outbox enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu_images_admin_insert" on storage.objects;
create policy "menu_images_admin_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'menu-images' and (select public.is_admin()));
drop policy if exists "menu_images_admin_update" on storage.objects;
create policy "menu_images_admin_update" on storage.objects
for update to authenticated
using (bucket_id = 'menu-images' and (select public.is_admin()))
with check (bucket_id = 'menu-images' and (select public.is_admin()));
drop policy if exists "menu_images_admin_delete" on storage.objects;
create policy "menu_images_admin_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'menu-images' and (select public.is_admin()));

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

drop policy if exists "profiles_read_own_or_admin" on public.profiles;
create policy "profiles_read_own_or_admin" on public.profiles
for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()))
with check ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "products_read_active_or_admin" on public.products;
create policy "products_read_active_or_admin" on public.products
for select to anon, authenticated
using (true);

drop policy if exists "products_admin_manage" on public.products;
create policy "products_admin_manage" on public.products
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "menu_categories_read_active_or_admin" on public.menu_categories;
create policy "menu_categories_read_active_or_admin" on public.menu_categories
for select to anon, authenticated
using (is_active or (select public.is_admin()));

drop policy if exists "menu_categories_admin_manage" on public.menu_categories;
create policy "menu_categories_admin_manage" on public.menu_categories
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "store_settings_public_read" on public.store_settings;
create policy "store_settings_public_read" on public.store_settings
for select to anon, authenticated
using (true);

drop policy if exists "store_settings_admin_manage" on public.store_settings;
create policy "store_settings_admin_manage" on public.store_settings
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "promotions_read_active_or_admin" on public.promotions;
create policy "promotions_read_active_or_admin" on public.promotions
for select to anon, authenticated
using (
  (is_active and exists (
    select 1 from public.products p
    where p.id = product_id and p.is_active
  ))
  or (select public.is_admin())
);

drop policy if exists "promotions_admin_manage" on public.promotions;
create policy "promotions_admin_manage" on public.promotions
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "orders_read_own_or_admin" on public.orders;
create policy "orders_read_own_or_admin" on public.orders
for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_admin()));

drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update" on public.orders
for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "order_items_read_order_owner_or_admin" on public.order_items;
create policy "order_items_read_order_owner_or_admin" on public.order_items
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.user_id = (select auth.uid()) or (select public.is_admin()))
  )
);

revoke all on public.notification_outbox from anon, authenticated;
revoke insert, update, delete on public.orders, public.order_items from anon, authenticated;
grant select on public.products, public.promotions to anon, authenticated;
grant select on public.menu_categories to anon, authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update, select on public.profiles to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant update (status) on public.orders to authenticated;
grant insert, update, delete, select on public.products, public.promotions to authenticated;
grant insert, update, delete on public.menu_categories to authenticated;
grant update on public.store_settings to authenticated;

create or replace function public.place_order(p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_order_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_promotion public.promotions%rowtype;
  v_product_id uuid;
  v_promotion_id uuid;
  v_quantity integer;
  v_unit_price numeric(10, 2);
  v_total numeric(10, 2) := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception using message = 'authentication_required', errcode = '28000';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using message = 'invalid_cart', errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception using message = 'invalid_cart', errcode = '22023';
  end if;

  select * into v_profile from public.profiles where user_id = v_user_id;
  if not found or length(trim(v_profile.full_name)) < 3 or length(trim(v_profile.phone)) = 0
    or length(trim(v_profile.street)) = 0 or length(trim(v_profile.street_number)) = 0
    or length(trim(v_profile.neighborhood)) = 0 or length(trim(v_profile.city)) = 0 then
    raise exception using message = 'profile_required', errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  if exists (
    select 1 from public.orders
    where user_id = v_user_id and created_at > now() - interval '30 seconds'
  ) then
    raise exception using message = 'rate_limited', errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using message = 'invalid_cart', errcode = '22023';
    end if;
    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_quantity := (v_item ->> 'quantity')::integer;
      v_promotion_id := nullif(v_item ->> 'promotion_id', '')::uuid;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using message = 'invalid_cart', errcode = '22023';
    end;

    if v_quantity is null or v_quantity < 1 or v_quantity > 50 then
      raise exception using message = 'invalid_cart', errcode = '22023';
    end if;
    select * into v_product from public.products
    where id = v_product_id and is_active
    for update;
    if not found or (v_product.stock is not null and v_product.stock < v_quantity) then
      raise exception using message = 'product_unavailable', errcode = 'P0001';
    end if;
    v_unit_price := coalesce(v_product.promotional_price, v_product.price);

    if v_promotion_id is not null then
      select * into v_promotion from public.promotions
      where id = v_promotion_id and product_id = v_product_id and is_active
        and price <= coalesce(v_product.promotional_price, v_product.price)
        and (ends_at is null or ends_at > now());
      if not found then
        raise exception using message = 'promotion_unavailable', errcode = 'P0001';
      end if;
      v_unit_price := least(v_unit_price, v_promotion.price);
    end if;

    if v_product.stock is not null then
      update public.products set stock = stock - v_quantity where id = v_product.id;
    end if;
    v_total := v_total + v_unit_price * v_quantity;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'product_name', v_product.name,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'line_total', v_unit_price * v_quantity
    ));
  end loop;

  insert into public.orders (user_id, total) values (v_user_id, v_total) returning id into v_order_id;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, line_total)
  select v_order_id,
    (item ->> 'product_id')::uuid,
    item ->> 'product_name',
    (item ->> 'quantity')::integer,
    (item ->> 'unit_price')::numeric,
    (item ->> 'line_total')::numeric
  from jsonb_array_elements(v_items) as entries(item);

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

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

create or replace function public.enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_event_type text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  select * into v_profile from public.profiles where user_id = new.user_id;
  v_event_type := case when tg_op = 'INSERT' then 'order_created' else 'order_status_changed' end;

  insert into public.notification_outbox (event_type, order_id, payload)
  values (
    v_event_type,
    new.id,
    jsonb_build_object(
      'event_type', v_event_type,
      'order_id', new.id,
      'customer_name', v_profile.full_name,
      'phone', case when v_profile.whatsapp_opt_in then v_profile.phone else null end,
      'status', new.status
    )
  );
  return new;
end;
$$;

drop trigger if exists orders_enqueue_notification on public.orders;
create trigger orders_enqueue_notification after insert or update on public.orders
for each row execute function public.enqueue_order_notification();

insert into public.products (name, category, description, price, image_url)
values
  ('Bife de gado simples', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 26.00, 'assets/Bife De Gado Simples.png'),
  ('Filé de frango simples', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 26.00, 'assets/bife de frango simples.png'),
  ('Bife de gado acebolado', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, cebola na chapa, salada e sobremesa.', 28.00, 'assets/Bife De Gado Acebolado.png'),
  ('Filé de frango acebolado', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, cebola na chapa, salada e sobremesa.', 28.00, 'assets/Filé De Frango Acebolado.png'),
  ('Bife de gado à milanesa', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 32.00, 'assets/gado a milanesa.png'),
  ('Filé de frango à milanesa', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 32.00, 'assets/frango a milanesa.png'),
  ('Filé de peixe à dorê', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 30.00, 'assets/peixe a doré.png'),
  ('Filé de peixe à milanesa', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 32.00, 'assets/filé de Peixe À Milanesa.png'),
  ('Bife de gado à parmegiana', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 35.00, 'assets/Bife De Gado À Parmegiana.png'),
  ('Frango à parmegiana', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 35.00, 'assets/Frango À Parmegiana.png'),
  ('Strogonoff de gado', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 40.00, 'assets/Strogonoff De Gado.png'),
  ('Strogonoff de frango', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 40.00, 'assets/Strogonoff De Frango.png'),
  ('Proteína extra do prato do dia', 'porcoes', null, 10.00, null),
  ('Arroz', 'porcoes', null, 8.00, null),
  ('Feijão', 'porcoes', null, 8.00, null),
  ('Massa', 'porcoes', null, 8.00, null),
  ('Batata frita', 'porcoes', null, 10.00, null),
  ('Ovo frito', 'porcoes', null, 3.00, null),
  ('Cebola na chapa', 'porcoes', null, 7.00, null),
  ('Filé de frango simples (porção)', 'porcoes', null, 10.00, 'assets/bife de frango simples.png'),
  ('Bife de gado acebolado (porção)', 'porcoes', null, 15.00, 'assets/Bife De Gado Acebolado.png'),
  ('Filé de frango acebolado (porção)', 'porcoes', null, 15.00, 'assets/Filé De Frango Acebolado.png'),
  ('Bife de gado à milanesa (porção)', 'porcoes', null, 15.00, 'assets/gado a milanesa.png'),
  ('Filé de frango à milanesa (porção)', 'porcoes', null, 15.00, 'assets/frango a milanesa.png'),
  ('Filé de peixe à dorê (porção)', 'porcoes', null, 10.00, 'assets/peixe a doré.png'),
  ('Filé de peixe à milanesa (porção)', 'porcoes', null, 15.00, 'assets/filé de Peixe À Milanesa.png'),
  ('Bife de gado simples (porção)', 'porcoes', null, 10.00, 'assets/Bife De Gado Simples.png'),
  ('Água sem gás 500 ml', 'bebidas', null, 4.00, 'assets/agua s gas.jpg'),
  ('Água com gás 500 ml', 'bebidas', null, 4.00, 'assets/agua c gas.jpg'),
  ('Guaraná Charrua 350 ml', 'bebidas', null, 5.00, 'assets/guarana.jpg'),
  ('Pepsi 350 ml', 'bebidas', null, 8.00, 'assets/pepsi.jpg'),
  ('Coca-Cola 350 ml', 'bebidas', null, 8.00, 'assets/coca.jpg')
on conflict (category, name) do nothing;

with ranked_products as (
  select id, row_number() over (partition by category order by name, id) - 1 as sort_order
  from public.products
)
update public.products as product
set sort_order = ranked_products.sort_order
from ranked_products
where product.id = ranked_products.id
  and exists (
    select 1
    from public.products as category_products
    where category_products.category = product.category
    group by category_products.category
    having min(category_products.sort_order) = max(category_products.sort_order)
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
