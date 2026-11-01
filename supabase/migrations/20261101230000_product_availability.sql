drop policy if exists "products_read_active_or_admin" on public.products;
create policy "products_read_active_or_admin" on public.products
for select to anon, authenticated
using (true);

insert into public.products (name, category, description, price, image_url)
values
  ('Bife de gado simples', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 26.00, 'assets/Bife De Gado Simples.png'),
  ('Bife de gado acebolado', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, cebola na chapa, salada e sobremesa.', 28.00, 'assets/Bife De Gado Acebolado.png'),
  ('Filé de frango acebolado', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, cebola na chapa, salada e sobremesa.', 28.00, 'assets/Filé De Frango Acebolado.png'),
  ('Bife de gado à milanesa', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 32.00, 'assets/gado a milanesa.png'),
  ('Filé de frango à milanesa', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 32.00, 'assets/frango a milanesa.png'),
  ('Bife de gado à parmegiana', 'a-la-minuta', 'Arroz, feijão, batata frita, ovo, salada e sobremesa.', 35.00, 'assets/Bife De Gado À Parmegiana.png')
on conflict (category, name) do nothing;
