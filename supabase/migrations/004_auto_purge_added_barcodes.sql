-- Invariant: barcode_no yang ADA di barcode_items (data utama)
-- tidak boleh berada di added_barcodes (menu Detail).
-- Trigger membersihkan otomatis saat master mendapat / mengubah barcode.
create or replace function public.sync_added_barcodes_with_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.added_barcodes where barcode_no = new.barcode_no;
  return new;
end;
$fn$;

drop trigger if exists trg_purge_added_barcodes on public.barcode_items;
create trigger trg_purge_added_barcodes
after insert or update of barcode_no on public.barcode_items
for each row
execute function public.sync_added_barcodes_with_master();

-- Cleanup sekali jalan untuk data yang sudah terlanjur overlap.
delete from public.added_barcodes a
using public.barcode_items b
where a.barcode_no = b.barcode_no;
