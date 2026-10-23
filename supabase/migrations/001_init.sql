-- Migration 001: Inisialisasi tabel profiles dan RLS untuk autentikasi
-- Jalankan lewat Supabase SQL Editor sebelum menjalankan aplikasi.

-- Tabel profiles: menyimpan role pengguna
create table if not exists public.profiles (
  id uuid references auth.users not null primary key,
  email text not null,
  role text not null default 'leader',
  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Policies: pengguna hanya bisa baca/tulis profil milik sendiri
create policy "Pengguna bisa lihat profil sendiri"
  on public.profiles for select
  using ( auth.uid() = id );

create policy "Pengguna bisa update profil sendiri"
  on public.profiles for update
  using ( auth.uid() = id );

create policy "Pengguna bisa insert profil sendiri"
  on public.profiles for insert
  with check ( auth.uid() = id );

-- Index untuk pencarian cepat
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role);