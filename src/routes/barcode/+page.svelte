<script lang="ts">
  import { supabase } from '$lib/supabase';
  import Swal from 'sweetalert2';

  interface BarcodeRow {
    item_no: string;
    barcode_no: string;
    description: string;
    category_name: string | null;
  }

  interface PendingRow {
    item_no: string;
    barcode_no: string;
    description: string;
    category_name: string;
  }

  let searchQuery = $state('');
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let suggestions = $state<string[]>([]);
  let showSuggestions = $state(false);
  let results = $state<BarcodeRow[]>([]);
  let loadingResults = $state(false);
  let selectedDescription = $state('');
  let saving = $state(false);

  let pending = $state<PendingRow[]>([]);

  async function onSearchInput() {
    if (searchTimeout) clearTimeout(searchTimeout);
    suggestions = [];
    showSuggestions = false;
    results = [];
    selectedDescription = '';

    const q = searchQuery.trim();
    if (q.length < 2) return;

    searchTimeout = setTimeout(async () => {
      try {
        loadingResults = true;
        const { data, error } = await supabase
          .from('barcode_items')
          .select('description')
          .ilike('description', `%${q}%`)
          .limit(20);

        if (error) throw error;

        const distinct = [
          ...new Set((data ?? []).map((r) => r.description).filter(Boolean))
        ];
        suggestions = distinct as string[];
        showSuggestions = suggestions.length > 0;
      } catch (err: any) {
        console.error(err);
      } finally {
        loadingResults = false;
      }
    }, 250);
  }

  async function selectDescription(desc: string) {
    selectedDescription = desc;
    showSuggestions = false;
    suggestions = [];

    try {
      loadingResults = true;
      const { data, error } = await supabase
        .from('barcode_items')
        .select('item_no, barcode_no, description, category_name')
        .eq('description', desc)
        .order('item_no');

      if (error) throw error;
      results = (data ?? []) as BarcodeRow[];
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal memuat data', text: err.message });
    } finally {
      loadingResults = false;
    }
  }

  function addToPending(item: BarcodeRow) {
    const already = pending.find(
      (p) =>
        p.item_no === item.item_no &&
        p.description === item.description &&
        p.barcode_no === item.barcode_no
    );
    if (already) return;

    pending.push({
      item_no: item.item_no,
      barcode_no: '',
      description: item.description,
      category_name: item.category_name ?? ''
    });
  }

  function removePending(index: number) {
    pending.splice(index, 1);
  }

  async function handleSave() {
    if (pending.length === 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Tidak ada data pending',
        text: 'Tambahkan minimal satu barcode ke daftar pending.',
        confirmButtonText: 'Oke'
      });
      return;
    }

    const emptyRows = pending.filter((p) => !p.barcode_no.trim());
    if (emptyRows.length > 0) {
      await Swal.fire({
        icon: 'error',
        title: 'Validasi gagal',
        text: 'Barcode No harus diisi pada semua baris pending.',
        confirmButtonText: 'Oke'
      });
      return;
    }

    const trimmedNos = pending.map((p) => p.barcode_no.trim());
    if (new Set(trimmedNos).size !== trimmedNos.length) {
      await Swal.fire({
        icon: 'error',
        title: 'Validasi gagal',
        text: 'Barcode No tidak boleh duplikat dalam satu batch pending.',
        confirmButtonText: 'Oke'
      });
      return;
    }

    saving = true;
    try {
      const { data: existingItems, error: errItems } = await supabase
        .from('barcode_items')
        .select('barcode_no')
        .in('barcode_no', trimmedNos);

      if (errItems) throw errItems;

      const { data: existingAdded, error: errAdded } = await supabase
        .from('added_barcodes')
        .select('barcode_no')
        .in('barcode_no', trimmedNos);

      if (errAdded) throw errAdded;

      const existingNos = new Set([
        ...(existingItems ?? []).map((r) => r.barcode_no),
        ...(existingAdded ?? []).map((r) => r.barcode_no)
      ]);

      const conflictRows = pending.filter((p) => existingNos.has(p.barcode_no.trim()));
      if (conflictRows.length > 0) {
        const rowList = conflictRows.map((p) => p.barcode_no).join(', ');
        await Swal.fire({
          icon: 'error',
          title: 'Barcode sudah terdaftar',
          text: `Barcode No berikut sudah ada: ${rowList}`,
          confirmButtonText: 'Oke'
        });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const addedBy = session?.user?.email ?? 'sistem';

      const toInsert = pending.map((p) => ({
        item_no: p.item_no,
        barcode_no: p.barcode_no.trim(),
        description: p.description,
        category_name: p.category_name,
        added_by: addedBy,
        created_at: new Date().toISOString()
      }));

      const { error: insertError } = await supabase.from('added_barcodes').insert(toInsert);
      if (insertError) throw insertError;

      await Swal.fire({
        icon: 'success',
        title: 'Berhasil disimpan',
        text: `${toInsert.length} barcode berhasil ditambahkan.`,
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });

      pending = [];
      results = [];
      selectedDescription = '';
      searchQuery = '';
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal menyimpan', text: err.message });
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-6">
  <!-- Search -->
  <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
    <div class="flex flex-col sm:flex-row sm:items-center gap-4">
      <div class="relative w-full min-w-0">
        <label class="block text-sm font-medium text-gray-700 mb-2" for="search-input">
          Cari Description
        </label>
        <input
          id="search-input"
          type="text"
          bind:value={searchQuery}
          oninput={onSearchInput}
          placeholder="Ketik kata kunci description..."
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
        />
        {#if loadingResults}
          <div class="absolute right-3 top-1/2 -translate-y-1/2">
            <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Suggestions -->
    {#if showSuggestions && suggestions.length > 0}
      <div class="mt-2 border border-gray-200 rounded-lg shadow-lg bg-white max-h-60 overflow-y-auto z-20">
        {#each suggestions as desc}
          <button
            onclick={() => selectDescription(desc)}
            class="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
          >
            {desc}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Hasil pencarian -->
  {#if selectedDescription && results.length > 0}
    <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-gray-900">
          Hasil untuk: <span class="text-blue-600 font-mono">{selectedDescription}</span>
        </h2>
        <span class="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
          {results.length} baris
        </span>
      </div>

      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-gray-500 border-b border-gray-200">
            <th class="pb-3 font-medium">Item No</th>
            <th class="pb-3 font-medium">Barcode No</th>
            <th class="pb-3 font-medium">Description</th>
            <th class="pb-3 font-medium">Category Name</th>
            <th class="pb-3 font-medium text-right w-20">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each results as row}
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td class="py-3 text-gray-700 font-mono">{row.item_no}</td>
              <td class="py-3 text-gray-700 font-mono">{row.barcode_no}</td>
              <td class="py-3 text-gray-700">{row.description}</td>
              <td class="py-3 text-gray-700">{row.category_name ?? '-'}</td>
              <td class="py-3 text-right">
                <button
                  onclick={() => addToPending(row)}
                  class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md transition-colors shadow-sm"
                >
                  Tambah
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}


  <!-- Pending -->
  {#if pending.length > 0}
    <div class="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-100">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-blue-900">Daftar Pending ({pending.length})</h2>
        <button
          onclick={handleSave}
          disabled={saving}
          class="px-4 py-2 bg-blue-600 disabled:bg-blue-300 hover:!bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {saving ? 'Menyimpan...' : 'Simpan Semua'}
        </button>
      </div>

      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="text-left text-blue-700 border-b border-blue-200">
            <th class="pb-3 font-medium">Item No</th>
            <th class="pb-3 font-medium">Barcode No <span class="text-xs text-red-500 ml-1">*</span></th>
            <th class="pb-3 font-medium">Description</th>
            <th class="pb-3 font-medium">Category Name</th>
            <th class="pb-3 font-medium text-right w-16">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {#each pending as p, i}
            <tr class="border-b border-blue-100 hover:bg-blue-100/50 transition-colors">
              <td class="py-3 text-gray-700 font-mono">{p.item_no}</td>
              <td class="py-3">
                <input
                  type="text"
                  bind:value={p.barcode_no}
                  placeholder="Masukkan barcode no"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                />
              </td>
              <td class="py-3 text-gray-700">{p.description}</td>
              <td class="py-3 text-gray-700">{p.category_name ?? '-'}</td>
              <td class="py-3 text-right">
                <button
                  onclick={() => removePending(i)}
                  class="px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-md transition-colors"
                >
                  Hapus
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

