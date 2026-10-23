import 'dotenv/config';
import { createRequire } from 'module';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Service-role client (bypass RLS) hanya untuk import manual lokal,
// tidak dibundel ke client app. Ambil dari Supabase Dashboard → Settings → API → service_role secret.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAdmin = supabaseServiceRoleKey && supabaseUrl
  ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
  : null;

// Client yang dipakai untuk tulis: service-role kalau tersedia, else anon (akan gagal RLS tanpa login)
const db = supabaseAdmin ?? supabase;

const EXCEL_PATH = 'Report All Barcode (3).xlsx';
const SHEET_NAME = 'Report All Barcode';
const HEADER_ROW_INDEX = 4; // Row 5 (0-indexed) = header
const DATA_START_ROW_INDEX = 5; // Row 6 (0-indexed) = first data row

// Mapping kolom Excel (dengan spasi trailing) → kolom DB (tanpa spasi)
const COLUMN_MAP: Record<string, string> = {
  'Item No ': 'item_no',
  'Barcode No ': 'barcode_no',
  Description: 'description',
  'UOM Code': 'uom_code',
  'External Barcode': 'external_barcode',
  'Barcode Gs1': 'barcode_gs1',
  'Show for Item ': 'show_for_item',
  'Category Name': 'category_name'
};

type BarcodeItem = {
  item_no?: string;
  barcode_no?: string;
  description?: string;
  category_name?: string;
  uom_code?: string;
  external_barcode?: string;
  barcode_gs1?: string;
  show_for_item?: string;
};

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v === null || v === undefined || v === ''
  );
}

function cleanValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function main(): Promise<void> {
  console.log(`📖 Membaca file Excel: ${EXCEL_PATH}`);

  // Pastikan service-role key tersedia untuk bypass RLS (barcode_items read-only dari UI)
  if (!supabaseAdmin) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY tidak ditemukan di .env.');
    console.error('   Ambil dari Supabase Dashboard → Settings → API → service_role secret.');
    console.error('   Tambahkan ke .env:  SUPABASE_SERVICE_ROLE_KEY=<secret>');
    console.error('   Jika tidak tersedia, upload data manual lewat Supabase SQL Editor.');
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_PATH);

  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    console.error(`❌ Sheet "${SHEET_NAME}" tidak ditemukan di file Excel.`);
    process.exit(1);
  }

  const worksheet = workbook.Sheets[SHEET_NAME];
  const jsonData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true
  }) as unknown[][];

  if (jsonData.length <= HEADER_ROW_INDEX) {
    console.error('❌ File Excel tidak cukup baris (butuh minimal Row 5 sebagai header).');
    process.exit(1);
  }

  // Ambil header dari Row 5 (index 4)
  const rawHeader = jsonData[HEADER_ROW_INDEX] as unknown[];
  const headerNames = rawHeader.map((h) => (h === null || h === undefined ? '' : String(h)));

  // Bangun mapping index kolom → nama kolom DB
  const colIndexToDbColumn: Record<number, string> = {};
  headerNames.forEach((name, idx) => {
    // Toleransi spasi trailing/header tidak konsisten di file Excel asli
    const mapped = COLUMN_MAP[name] ?? COLUMN_MAP[name.trim()];
    if (mapped) {
      colIndexToDbColumn[idx] = mapped;
    }
  });

  if (Object.keys(colIndexToDbColumn).length === 0) {
    console.error('❌ Tidak ada kolom yang cocok dengan mapping. Cek header Row 5.');
    process.exit(1);
  }

  // Proses data mulai Row 6 (index 5)
  let rowsRead = 0;
  let rowsSaved = 0;
  let rowsFailed = 0;
  const failedRows: { row: number; reason: string; data: unknown }[] = [];
  const itemsToInsert: BarcodeItem[] = [];

  for (let i = DATA_START_ROW_INDEX; i < jsonData.length; i++) {
    const row = jsonData[i];
    if (!row) continue;

    const item: BarcodeItem = {};
    let hasData = false;

    Object.entries(colIndexToDbColumn).forEach(([idxStr, dbColumn]) => {
      const idx = Number(idxStr);
      const val = cleanValue(row[idx]);
      if (val !== null) {
        item[dbColumn as keyof BarcodeItem] = val;
        hasData = true;
      }
    });

    // Skip baris kosong (tidak dihitung dalam rowsRead)
    if (!hasData) {
      console.log(`⏭️  Baris ${i + 1}: kosong, dilewati.`);
      continue;
    }

    rowsRead++;

    // Validasi barcode_no wajib ada
    if (!item.barcode_no) {
      rowsFailed++;
      failedRows.push({
        row: i + 1,
        reason: 'Barcode No kosong',
        data: row
      });
      console.log(`❌ Baris ${i + 1}: Barcode No kosong, gagal.`);
      continue;
    }

    itemsToInsert.push(item);
  }

  console.log(`\n📊 Total baris dibaca: ${rowsRead}`);
  console.log(`📦 Siap disimpan: ${itemsToInsert.length}`);

  // Upsert ke Supabase (unique constraint pada barcode_no) dalam batch kecil
  const BATCH_SIZE = 100;
  if (itemsToInsert.length > 0) {
    console.log(`🔄 Mulai upsert ${itemsToInsert.length} baris dalam batch ${BATCH_SIZE}...`);
    for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
      const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(itemsToInsert.length / BATCH_SIZE);

      const { error, count } = await db
        .from('barcode_items')
        .upsert(batch, {
          onConflict: 'barcode_no'
        });

      if (error) {
        console.error(`❌ Batch ${batchNum}/${totalBatches} gagal: ${error.message}`);
        // Coba satu per satu dalam batch ini
        for (const item of batch) {
          const { error: singleError } = await db
            .from('barcode_items')
            .upsert([item], { onConflict: 'barcode_no' });
          if (singleError) {
            rowsFailed++;
            failedRows.push({
              row: -1,
              reason: singleError.message,
              data: item
            });
            console.log(`❌ Gagal barcode_no=${item.barcode_no}: ${singleError.message}`);
          } else {
            rowsSaved++;
            console.log(`✅ Tersimpan: barcode_no=${item.barcode_no}`);
          }
        }
      } else {
        const saved = count ?? batch.length;
        rowsSaved += saved;
        console.log(`✅ Batch ${batchNum}/${totalBatches}: ${saved} baris tersimpan.`);
      }
    }
  }

  // Ringkasan
  console.log('\n========================================');
  console.log('RINGKASAN IMPORT');
  console.log('========================================');
  console.log(`Baris dibaca   : ${rowsRead}`);
  console.log(`Berhasil simpan: ${rowsSaved}`);
  console.log(`Gagal          : ${rowsFailed}`);
  console.log(`Total          : ${rowsSaved + rowsFailed} (harus = ${rowsRead})`);

  if (rowsSaved + rowsFailed !== rowsRead) {
    console.error('❌ PERINGATAN: Ada selisih jumlah baris! Terdapat row yang hilang.');
    process.exit(1);
  }

  if (failedRows.length > 0) {
    console.log('\nDetail baris gagal:');
    failedRows.forEach((f) => {
      console.log(`  - Baris ${f.row}: ${f.reason}`);
    });
  }

  if (rowsFailed === 0) {
    console.log('\n🎉 Semua baris berhasil diproses tanpa kehilangan data.');
  } else {
    console.log(`\n⚠️  Ada ${rowsFailed} baris yang gagal disimpan.`);
  }
}

main().catch((err) => {
  console.error('❌ Error tak terduga:', err);
  process.exit(1);
});