<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import Swal from 'sweetalert2';

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

  onMount(() => {
    loadData();
  });
</script>

<div class="space-y-6">
  <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
    <h1 class="text-xl font-bold text-gray-900 mb-6">Detail Barcode</h1>

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
            </tr>
          </thead>
          <tbody>
            {#each data as row}
              <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td class="py-3 text-gray-700 font-mono">{row.item_no}</td>
                <td class="py-3 text-gray-700 font-mono">{row.barcode_no}</td>
                <td class="py-3 text-gray-700">{row.description}</td>
                <td class="py-3 text-gray-700">{row.category_name ?? '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
