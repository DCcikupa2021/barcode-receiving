-- Migration 002: Tabel barcode_items (master dari Excel) dan added_barcodes (hasil Add Barcode)
-- Jalankan lewat Supabase SQL Editor setelah migration 001_init.sql.

-- Extension untuk gen_random_uuid()
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabel barcode_items: master data barcode dari Excel (read-only dari app)
-- ---------------------------------------------------------------------------
create table if not exists public.barcode_items (
  id uuid default gen_random_uuid() primary key,
  item_no text not null,
  barcode_no text not null unique,
  description text,
  category_name text,
  uom_code text,
  external_barcode text,
  barcode_gs1 text,
  show_for_item text,
  created_at timestamp with time zone default now()
);

alter table public.barcode_items enable row level security;

-- Hanya pengguna terautentikasi yang boleh baca master barcode
create policy "Pengguna terautentikasi bisa lihat barcode_items"
  on public.barcode_items for select
  to authenticated
  using ( true );

-- Index untuk pencarian suggestion Description (case-insensitive via ilike)
create index if not exists barcode_items_description_idx on public.barcode_items (description);
create index if not exists barcode_items_barcode_no_idx on public.barcode_items (barcode_no);

-- ---------------------------------------------------------------------------
-- Tabel added_barcodes: hasil tombol "Add Barcode" dari aplikasi
-- Data ini TIDAK pernah ditulis ke barcode_items.
-- ---------------------------------------------------------------------------
create table if not exists public.added_barcodes (
  id uuid default gen_random_uuid() primary key,
  item_no text not null,
  barcode_no text not null unique,
  description text not null,
  category_name text,
  added_by text not null,
  created_at timestamp with time zone default now()
);

alter table public.added_barcodes enable row level security;

-- Pengguna terautentikasi bisa lihat semua data added_barcodes
create policy "Pengguna terautentikasi bisa lihat added_barcodes"
  on public.added_barcodes for select
  to authenticated
  using ( true );

-- Pengguna terautentikasi bisa insert hasil Add Barcode
create policy "Pengguna terautentikasi bisa tambah added_barcodes"
  on public.added_barcodes for insert
  to authenticated
  with check ( true );

-- Semua role boleh hapus dari History (konfirmasi lewat SweetAlert2 di app)
create policy "Pengguna terautentikasi bisa hapus added_barcodes"
  on public.added_barcodes for delete
  to authenticated
  using ( true );

-- Index untuk History diurutkan created_at DESC
create index if not exists added_barcodes_created_at_idx on public.added_barcodes (created_at desc);
create index if not exists added_barcodes_barcode_no_idx on public.added_barcodes (barcode_no);
create index if not exists added_barcodes_added_by_idx on public.added_barcodes (added_by);
