<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import Swal from 'sweetalert2';
  import * as XLSX from 'xlsx';
  import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

  interface AddedBarcode {
    id: string;
    item_no: string;
    barcode_no: string;
    description: string;
    category_name: string | null;
    added_by: string;
    created_at: string;
  }

  let data = $state<AddedBarcode[]>([]);
  let loading = $state(false);
  let exporting = $state(false);
  let deletingId = $state<string | null>(null);

  async function loadData() {
    loading = true;
    try {
      const { data: rows, error } = await supabase
        .from('added_barcodes')
        .select('id, item_no, barcode_no, description, category_name, added_by, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      data = (rows ?? []) as AddedBarcode[];
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal memuat data', text: err.message });
    } finally {
      loading = false;
    }
  }

  /** Format waktu Asia/Jakarta menjadi DD/MM/YYYY HH:mm */
  function formatWaktu(iso: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(new Date(iso));

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? '';

    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  }

  /** Tanggal hari ini (Asia/Jakarta) dalam format YYYY-MM-DD */
  function todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  async function handleExport() {
    if (exporting) return;

    if (data.length === 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Tidak ada data',
        text: 'Belum ada data barcode untuk diexport.',
        confirmButtonColor: '#2563eb'
      });
      return;
    }

    exporting = true;
    try {
      const rows = data.map((row) => ({
        'Item No': row.item_no,
        'Barcode No': row.barcode_no,
        Description: row.description,
        'Category Name': row.category_name ?? '',
        Waktu: formatWaktu(row.created_at),
        User: row.added_by
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Detail Barcode');
      XLSX.writeFile(workbook, `detail-barcode-${todayStr()}.xlsx`);
    } catch (err: any) {
      await Swal.fire({
        icon: 'error',
        title: 'Gagal export',
        text: err?.message ?? 'Terjadi kesalahan saat membuat file Excel.'
      });
    } finally {
      exporting = false;
    }
  }

  async function handleDelete(id: string, barcodeNo: string) {
    const confirmed = await Swal.fire({
      icon: 'question',
      title: 'Hapus barcode?',
      text: `Yakin ingin menghapus barcode ${barcodeNo} dari detail?`,
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      reverseButtons: true
    });

    if (!confirmed.isConfirmed) return;

    deletingId = id;
    try {
      const { error } = await supabase.from('added_barcodes').delete().eq('id', id);
      if (error) throw error;

      await Swal.fire({
        icon: 'success',
        title: 'Berhasil dihapus',
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });

      data = data.filter((row) => row.id !== id);
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal menghapus', text: err.message });
    } finally {
      deletingId = null;
    }
  }

  /** Terapkan perubahan realtime ke state lokal tanpa refresh halaman. */
  function applyRealtimeChange(payload: RealtimePostgresChangesPayload<AddedBarcode>) {
    try {
      if (payload.eventType === 'INSERT') {
        const row = payload.new as AddedBarcode;
        if (!row?.id || data.some((r) => r.id === row.id)) return;
        data = [row, ...data].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      } else if (payload.eventType === 'UPDATE') {
        const row = payload.new as AddedBarcode;
        if (!row?.id) return;
        data = data.map((r) => (r.id === row.id ? row : r));
      } else if (payload.eventType === 'DELETE') {
        const oldId = payload.old?.id;
        if (!oldId) {
          // payload.old tidak membawa id (replica identity) -> muat ulang manual
          loadData();
          return;
        }
        data = data.filter((r) => r.id !== oldId);
      }
    } catch (err) {
      console.warn('[detail] Gagal menerapkan perubahan realtime, memuat ulang data', err);
      loadData();
    }
  }

  onMount(() => {
    loadData();

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel('detail-ch')
        .on<AddedBarcode>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'added_barcodes' },
          (payload) => applyRealtimeChange(payload)
        )
        .subscribe((status) => {
          const state = status as string;
          if (state === 'SUBSCRIBED') return;
          if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            console.warn(
              `[detail] Realtime subscription ${state} — fallback ke muat data manual.`
            );
            // Halaman tetap jalan tanpa realtime; muat ulang agar data tetap akurat.
            loadData();
          }
        });
    } catch (err) {
      console.warn('[detail] Gagal membuat channel realtime, fallback ke muat data manual', err);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (err) {
          console.warn('[detail] Gagal remove channel realtime', err);
        }
      }
    };
  });
</script>

<div class="space-y-6">
  <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <h1 class="text-xl font-bold text-gray-900">Detail Barcode</h1>
      <button
        type="button"
        onclick={handleExport}
        disabled={exporting}
        class="px-4 py-2 bg-blue-600 disabled:bg-blue-300 hover:!bg-blue-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
      >
        {exporting ? 'Mengekspor...' : 'Export Excel'}
      </button>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    {:else if data.length === 0}
      <div class="flex flex-col items-center justify-center py-12 text-gray-500">
        <p class="text-sm">Belum ada data barcode yang ditambahkan.</p>
        <p class="text-xs mt-2">Gunakan halaman Barcode untuk menambahkan data baru.</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="text-left text-gray-500 border-b border-gray-200">
              <th class="pb-3 font-medium">Item No</th>
              <th class="pb-3 font-medium">Barcode No</th>
              <th class="pb-3 font-medium">Description</th>
              <th class="pb-3 font-medium">Category Name</th>
              <th class="pb-3 font-medium text-right w-24">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {#each data as row (row.id)}
              <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td class="py-3 text-gray-700 font-mono">{row.item_no}</td>
                <td class="py-3 text-gray-700 font-mono">{row.barcode_no}</td>
                <td class="py-3 text-gray-700">{row.description}</td>
                <td class="py-3 text-gray-700">{row.category_name ?? '-'}</td>
                <td class="py-3 text-right">
                  <button
                    type="button"
                    onclick={() => handleDelete(row.id, row.barcode_no)}
                    disabled={deletingId === row.id}
                    class="px-3 py-1.5 bg-red-600 disabled:bg-red-300 hover:!bg-red-700 text-white text-xs rounded-md transition-colors shadow-sm"
                  >
                    {deletingId === row.id ? 'Menghapus...' : 'Hapus'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
