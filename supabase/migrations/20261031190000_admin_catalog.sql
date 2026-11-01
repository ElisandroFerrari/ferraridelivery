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

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.products drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.products
  add column if not exists promotional_price numeric(10, 2),
  add column if not exists stock integer,
  add column if not exists complements jsonb not null default '[]'::jsonb;

alter table public.products
  drop constraint if exists products_image_url_check,
  add constraint products_image_url_check check (image_url is null or char_length(image_url) <= 2048),
  drop constraint if exists products_promotional_price_check,
  add constraint products_promotional_price_check check (
    promotional_price is null or (promotional_price > 0 and promotional_price < price)
  ),
  drop constraint if exists products_stock_check,
  add constraint products_stock_check check (stock is null or stock >= 0),
  drop constraint if exists products_complements_check,
  add constraint products_complements_check check (jsonb_typeof(complements) = 'array'),
  drop constraint if exists products_category_fkey,
  add constraint products_category_fkey foreign key (category) references public.menu_categories(key);

update public.promotions promotion
set is_active = false
where promotion.is_active
  and promotion.price > (
    select coalesce(product.promotional_price, product.price)
    from public.products product
    where product.id = promotion.product_id
  );

create or replace function public.validate_promotion_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product_price numeric(10, 2);
begin
  select coalesce(promotional_price, price) into v_product_price
  from public.products where id = new.product_id;
  if not found or new.price > v_product_price then
    raise exception using message = 'promotion_price_invalid', errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_product_price_against_promotions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_effective_price numeric(10, 2) := coalesce(new.promotional_price, new.price);
begin
  if v_effective_price > new.price or exists (
    select 1 from public.promotions
    where product_id = new.id and is_active and price > v_effective_price
  ) then
    raise exception using message = 'disable_or_update_promotions_first', errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists products_validate_promotions on public.products;
create trigger products_validate_promotions before update of price, promotional_price on public.products
for each row execute function public.validate_product_price_against_promotions();

alter table public.orders add column if not exists scheduled_for timestamptz;
create index if not exists orders_scheduled_for_idx on public.orders (scheduled_for) where scheduled_for is not null;

alter table public.menu_categories enable row level security;
drop policy if exists "menu_categories_read_active_or_admin" on public.menu_categories;
create policy "menu_categories_read_active_or_admin" on public.menu_categories
for select to anon, authenticated
using (is_active or (select public.is_admin()));
drop policy if exists "menu_categories_admin_manage" on public.menu_categories;
create policy "menu_categories_admin_manage" on public.menu_categories
for all to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));
grant select on public.menu_categories to anon, authenticated;
grant insert, update, delete on public.menu_categories to authenticated;

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
  select v_order_id, (item ->> 'product_id')::uuid, item ->> 'product_name',
    (item ->> 'quantity')::integer, (item ->> 'unit_price')::numeric, (item ->> 'line_total')::numeric
  from jsonb_array_elements(v_items) as entries(item);
  return v_order_id;
end;
$$;

grant execute on function public.place_order(jsonb) to authenticated;
