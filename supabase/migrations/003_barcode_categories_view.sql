-- View kategori untuk dropdown filter menu Barcode.
-- security_invoker = true supaya RLS barcode_items tetap berlaku
-- (policy: hanya authenticated yang boleh SELECT barcode_items).
create or replace view public.v_barcode_categories
with (security_invoker = true) as
select distinct category_name
from public.barcode_items
where category_name is not null and category_name <> ''
order by category_name;

grant select on public.v_barcode_categories to authenticated, anon;
