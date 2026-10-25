# PRD — Barcode Receiving App

## 1. Overview

Aplikasi web internal Mitra10 untuk pencarian barcode dari data master (Excel → Supabase), penambahan barcode baru, serta audit history. Scope termasuk script import Excel → Supabase (Step 0) dan aplikasi PWA-nya.

## 2. Sumber Data (Excel)

- File: `Report All Barcode (3).xlsx` (root project), sheet: `Report All Barcode`
- **Row 5 = header**, data mulai **Row 6 ke bawah** (sampai baris terakhir, tidak boleh ada yang kelewat)
- Header row 5 (persis, ada spasi di belakang):
  `Item No ` | `Barcode No ` | `Description` | `UOM Code` | `External Barcode` | `Barcode Gs1` | `Show for Item ` | `Category Name`
- **Unique key master: `Barcode No ` (ada spasi trailing)**

### Mapping ke tabel Supabase `barcode_items`

| Kolom Excel (header) | Kolom DB             | Keterangan                         |
| -------------------- | -------------------- | ---------------------------------- |
| `Item No `         | `item_no`          |                                    |
| `Barcode No `      | `barcode_no`       | UNIQUE, import harus dedupe/upsert |
| `Description`      | `description`      | Full-text search target            |
| `Category Name`    | `category_name`    |                                    |
| `UOM Code`         | `uom_code`         | opsional, simpan juga              |
| `External Barcode` | `external_barcode` | opsional                           |
| `Barcode Gs1`      | `barcode_gs1`      | opsional                           |
| `Show for Item `   | `show_for_item`    | opsional                           |

> Nama kolom DB tanpa spasi trailing (spasi trailing hanya label header Excel). Import script wajib: semua baris row 6+, handle duplikat `barcode_no` (upsert), row kosong di-skip, dan report jumlah baris dibaca vs jumlah baris tersimpan (harus match).

## 2b. Import Script (Step 0 — dibikin sekarang)

- Script lokal (Node.js) baca `Report All Barcode (3).xlsx`, **Row 5 = header, semua data Row 6 ke bawah**.
- Upsert ke `barcode_items` (unique `barcode_no`), handle duplikat & baris kosong.
- Wajib cetak ringkasan: jumlah baris dibaca vs berhasil disimpan vs duplikat/gagal — **0 kehilangan row**.
- Dijalankan manual (`npm run import`), bukan bagian app runtime.

## 3. Autentikasi (Step 1)

- Pakai **Supabase Auth** (email + password).
- 3 akun (password: `[REDACTED — lihat password manager]`):| Email                         | Role              |
  | ----------------------------- | ----------------- |
  | `administrator@mitra10.com` | `administrator` |
  | `admin@mitra10.com`         | `admin`         |
  | `leader@mitra10.com`        | `leader`        |
- Role disimpan di tabel `profiles` (user_id, email, role) atau `app_metadata.role`, dibuat saat setup.
- Halaman `/login`: field email + password, tombol login, redirect ke `/barcode` setelah sukses.
- Semua halaman app wajib login (protected route).

## 4. Layout (Step 2)

- Sidebar **expand / collapse** via tombol **hamburger (3 baris)**.
- Menu sidebar:
  1. **Barcode** (`/barcode`)
  2. **Detail** (`/detail`)
  3. **History** (`/history`)
- Topbar menampilkan email user + tombol logout.

## 5. Halaman Barcode (`/barcode`)

1. **Searchbox** — user ketik kata kunci → query on-keystroke (debounce ~250ms) ke Supabase kolom `description` (case-insensitive, `ilike %kata%`) → tampil **list suggestion Description** (distinct) di bawah searchbox, responsif saat mengetik (bukan Supabase realtime channel).
2. User **klik/pilih** salah satu Description → muncul **tabel** di bawahnya dengan header:
   `Item No` | `Barcode No` | `Description` | `Category Name`
   - Data dari `barcode_items` WHERE `description` = pilihan user.
   - Bisa 1, 2, 3, ... baris sesuai jumlah barcode terdaftar untuk deskripsi itu.
3. Di bawah tabel ada tombol **"Add Barcode"**:
   - Klik → tabel bertambah **1 baris input baru** (pending, belum tersimpan), misal pencarian "philips" hasilnya 3 baris → setelah add jadi 4 baris. Boleh klik lagi untuk baris pending berikutnya.
   - Baris pending: `Item No`, `Description`, `Category Name` **auto-copy** dari baris hasil pencarian (ambil baris pertama), user **hanya mengisi `Barcode No`**. Baris pending diberi penanda visual (mis. highlight) agar beda dari data tersimpan.
   - Di bawah tabel ada **satu tombol "Simpan"** — semua baris pending disimpan **sekaligus** saat diklik.
   - Validasi saat Simpan: semua `Barcode No` terisi & unik (cek `barcode_items.barcode_no` + `added_barcodes.barcode_no` antar baris pending juga). Ada 1 baris gagal → seluruh batch tidak disimpan, SweetAlert2 tampilkan baris yang bermasalah.
   - Baris hasil add **tidak disimpan ke `barcode_items`** — disimpan ke tabel terpisah: `added_barcodes`.
   - Sukses/gagal pakai SweetAlert2. Setelah sukses, baris pending berubah jadi baris tersimpan.

## 6. Tabel `added_barcodes` (Supabase)

| Kolom             | Tipe        | Keterangan                               |
| ----------------- | ----------- | ---------------------------------------- |
| `id`            | uuid/serial | PK                                       |
| `item_no`       | text        | disalin dari baris terpilih (atau input) |
| `barcode_no`    | text        | **UNIQUE**                         |
| `description`   | text        | disalin dari pilihan user                |
| `category_name` | text        | disalin dari baris terpilih              |
| `added_by`      | text/uuid   | email atau user id pelaku                |
| `created_at`    | timestamp   | timezone server, wajib                   |

## 7. Halaman Detail (`/detail`)

- Menampilkan **hanya data dari `added_barcodes`** ( hasil Add Barcode ).
- Data master `barcode_items` **TIDAK** ditampilkan di sini.
- Header tabel: `Item No` | `Barcode No` | `Description` | `Category Name`
- Urut: `created_at` DESC.

## 8. Halaman History (`/history`)

- Kolom (selayaknya history aplikasi modern): **Waktu** (tanggal + jam `created_at`), **User** (`added_by`), `Item No`, `Barcode No`, `Description`, `Category Name`, **Aksi**.
- Tiap baris punya tombol **Hapus** di kolom Aksi → hapus record dari `added_barcodes` (tanpa buka Supabase), untuk koreksi human error. **Semua role boleh hapus.**
- Konfirmasi sebelum hapus pakai **SweetAlert2** (bukan `confirm()` browser).
- Urut: `created_at` DESC. Filter/pencarian sederhana by user atau tanggal (opsional bila murah).

## 9. Non-Functional

- Data Excel: 0 kehilangan row (script import wajib print ringkasan read/saved/gagal).
- Search suggestion responsif (< 300ms) — pakai debounce ~250ms + index pada `description`.
- RLS Supabase: authenticated-only read/write; delete hanya lewat app.
- Browser desktop (resolusi kerja 1366px+), tetap tidak rusak di tablet.
- Stack: **SvelteKit (adapter-static, SPA mode) + TypeScript + Tailwind CSS + SweetAlert2 (lokal/bundled, bukan CDN) + @supabase/supabase-js**.
- Routing: rute `/barcode`, `/detail`, `/history`, `/login` via SvelteKit file-based routing; proteksi auth di root layout (redirect ke `/login` jika belum auth).
- **PWA**: installable (manifest + service worker), icon, theme-color, offline shell minimal.
- Notifikasi/toast/confirm **wajib pakai SweetAlert2**, bukan `alert()`/`confirm()` browser bawaan.
- Tampilan **PWA modern**: gelap/terang konsisten, radius halus, shadow lembut, spacing lega, micro-interaction singkat (transisi sidebar, list suggestion, hover row) — tidak kaku, tidak ketinggalan zaman.

## 10. Out of Scope

- CRUD data master (Excel/Supabase diurus lewat script import, bukan lewat app).
- Manajemen user/reset password dari dalam app.
- Export laporan.
- Pembedaan hak akses antar role (saat ini 3 role identik fiturnya; role dipakai untuk audit `added_by` dan siap dikembangkan).
