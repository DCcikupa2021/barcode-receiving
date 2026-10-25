-- Aktifkan Supabase Realtime untuk added_barcodes supaya
-- menu Detail bisa menampilkan hapus-otomatis tanpa refresh.
do $rt$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'added_barcodes'
  ) then
    alter publication supabase_realtime add table public.added_barcodes;
  end if;
end;
$rt$;
