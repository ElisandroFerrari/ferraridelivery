alter table public.products
  add column if not exists sort_order integer;

with ranked_products as (
  select id, row_number() over (partition by category order by name, id) - 1 as sort_order
  from public.products
)
update public.products as product
set sort_order = ranked_products.sort_order
from ranked_products
where product.id = ranked_products.id
  and product.sort_order is null;

alter table public.products
  alter column sort_order set default 0,
  alter column sort_order set not null;

create index if not exists products_category_sort_order_idx
  on public.products (category, sort_order, name);

drop policy if exists "products_read_active_or_admin" on public.products;
create policy "products_read_active_or_admin" on public.products
for select to anon, authenticated
using (true);
