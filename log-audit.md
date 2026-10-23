# Log Audit — Bug & Perbaikan

Format: `[Tanggal] | [Kategori] | [Deskripsi] | [File yang terlibat] | [Tindakan perbaikan] | [Status]`

---

## [2026-10-23] | TypeScript / Build | Alias `$lib` tidak dikenali oleh `svelte-check` | `tsconfig.json`, `src/routes/+layout.svelte`, `src/routes/login/+page.svelte` | Menambahkan `"extends": "./.svelte-kit/tsconfig.json"` di `tsconfig.json` agar alias `$lib` (dikonfigurasi SvelteKit di `.svelte-kit/tsconfig.json`) dikenali. Mengubah import `$lib/supabase.ts` menjadi `$lib/supabase` (tanpa ekstensi) di `+layout.svelte` dan `login/+page.svelte`. | ✅ Selesai

## [2026-10-23] | TypeScript | Tipe `session` tidak cocok dengan `Session` Supabase | `src/routes/+layout.svelte` | Mengganti tipe `session` dari `{ user: { email: string | null } } | null` menjadi `Session | null` (impor `type Session` dari `@supabase/supabase-js`). Diganti `$page.pathname` menjadi `$page.url.pathname`. Parameter `onAuthStateChange` dit type sebagai `(event: string, newSession: Session | null)`. | ✅ Selesai

## [2026-10-23] | A11y (svelte-check warning) | `<div>` dengan `onclick` tanpa keyboard handler dan ARIA role | `src/routes/+layout.svelte`, `src/routes/barcode/+page.svelte` | Sidebar overlay diubah menjadi `<div role="button" aria-label="Tutup sidebar" tabindex={0} onclick={...} onkeydown={...}>`. Suggestion item di `barcode` diubah dari `<div onclick>` menjadi `<button onclick>`. Label search di `barcode` diberi `for="search-input"` dan input diberi `id="search-input"`. Label Email/Password di `login` diberi `for`/`id` pasangan. | ✅ Selesai

## [2026-10-23] | Build / PowerShell | Perintah shell `&&` dan `2>/dev/null` tidak berfungsi di PowerShell | Tidak terkait file source | Menggunakan perintah PowerShell murni (titik-koma `;`, `2>$null`, `Get-Content` alih-alih `cat`, dll.) untuk menjalankan build dan check. | ✅ Selesai

## [2026-10-23] | Editor | File baru terlalu besar untuk satu panggilan editor | `src/routes/barcode/+page.svelte` | Membuat file secara bertahap: script terlebih dahulu, lalu insert konten HTML pada barisan berturut-turut (search section, results table, pending section). | ✅ Selesai

## [2026-10-23] | Migration | File `002_barcode_tables.sql` sudah dibuat, belum di-apply ke Supabase | `supabase/migrations/002_barcode_tables.sql` | File SQL sudah ditulis (tabel `barcode_items`, `added_barcodes`, RLS, index, `pgcrypto`). Belum dieksekusi ke project Supabase `barcode-receiveing`. | ⏳ Belum

## [2026-10-23] | TypeScript / Svelte 5 | `deletingId` di history page tidak reaktif (bukan `$state`) | `src/routes/history/+page.svelte` | Mengganti `let deletingId: string | null = null` menjadi `let deletingId = $state<string | null>(null)` agar tombol Hapus merespon state perubahan. | ✅ Selesai

## [2026-10-23] | Migration | Migration `001_init` dan `002_barcode_tables` diterapkan ke Supabase | `supabase/migrations/001_init.sql`, `supabase/migrations/002_barcode_tables.sql` | Dijalankan via `supabase__apply_migration` ke project `barcode-receiveing` (ref: `xuyzgdiwevfudttuxhrj`). Tabel `profiles`, `barcode_items`, `added_barcodes` terbuat dengan RLS aktif. | ✅ Selesai

## [2026-10-23] | Git | Belum ada commit untuk step 0–9 | Root project | Belum ada `git add` / `git commit` / `git push`. | ⏳ Belum

## [2026-10-23] | Import Excel | Import `Report All Barcode (3).xlsx` gagal awalnya karena RLS pada `barcode_items` | `scripts/import.ts`, `.env` | Menambahkan `SUPABASE_SERVICE_ROLE_KEY` ke `.env`, mengubah import script untuk pakai service_role client (bypass RLS), header mapping tolerant spasi trailing. Import dijalankan: 244.318 tersimpan, 2 gagal (`barcode_no` kosong), 1 baris kosong dilewati. | ✅ Selesai

## [2026-10-23] | Import Script | Warning "selisih jumlah baris" karena baris kosong dihitung dalam `rowsRead` | `scripts/import.ts` | Memindahkan `rowsRead++` setelah pengecekan `hasData`, sehingga baris kosong tidak lagi dihitung. | ✅ Selesai

## [2026-10-23] | Fitur Baru | Menu `Pengaturan` untuk buat akun baru via app | `supabase/functions/create-user/index.ts`, `src/routes/pengaturan/+page.svelte`, `src/routes/+layout.svelte` | Edge Function `create-user` (service_role key, buat auth user + profil), halaman `/pengaturan` (form email/password/role, SweetAlert2), menu hanya visible untuk role `administrator` (role diambil dari tabel `profiles`). Build ✅. Edge Function ter-deploy ke Supabase (status ACTIVE). | ✅ Selesai

## [2026-10-23] | Auth | Buat akun administrator manual di Supabase Auth + profil di tabel `profiles` | Supabase Dashboard → Authentication → Users, `public.profiles` | Email `administrator@mitra10.com`, password `admin123`, role `administrator`, UUID `8077178a-3245-4ba9-86f9-f88c34be1f73`. Akun `admin@` dan `leader@` dibuat lewat menu `/pengaturan` di aplikasi. | ✅ Selesai
