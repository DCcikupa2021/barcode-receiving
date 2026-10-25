<script lang="ts">
  import { supabase } from '$lib/supabase';
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    Html5Qrcode,
    Html5QrcodeSupportedFormats,
    type Html5QrcodeCameraScanConfig
  } from 'html5-qrcode';
  import Swal from 'sweetalert2';

  interface BarcodeRow {
    item_no: string;
    barcode_no: string;
    description: string;
    category_name: string | null;
  }

  /**
   * Model pending: satu entri per ITEM (bukan per barcode).
   * `slots` menampung barcode yang BELUM tersimpan (hasil ketik/pindai);
   * string kosong = slot kosong. `savedBarcodes` = snapshot barcode item
   * tersebut yang SUDAH tersimpan — sumber kolom "Barcode No" di tabel.
   * Saat "Simpan Semua" berhasil, slot terisi dipindahkan ke
   * `savedBarcodes`, sehingga simpanan berikutnya hanya memuat barcode baru.
   */
  interface PendingItem {
    id: string;
    item_no: string;
    description: string;
    category_name: string;
    slots: string[];
    savedBarcodes: string[];
  }

  type SearchField = 'item_no' | 'barcode_no' | 'description';

  const SEARCH_FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
    { value: 'item_no', label: 'Item No', placeholder: 'Cari item no...' },
    { value: 'barcode_no', label: 'Barcode No', placeholder: 'Cari barcode no...' },
    { value: 'description', label: 'Description', placeholder: 'Cari description...' }
  ];

  // ---- state pencarian ----
  let searchField = $state<SearchField>('description');
  let searchQuery = $state('');
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let suggestions = $state<string[]>([]);
  let showSuggestions = $state(false);
  let results = $state<BarcodeRow[]>([]);
  let loadingResults = $state(false);
  let selectedValue = $state('');
  let saving = $state(false);

  // ---- R1: filter kategori (view v_barcode_categories) ----
  let categories = $state<string[]>([]);
  let selectedCategory = $state(''); // '' = Semua Kategori
  let categoriesLoaded = $state(false);

  // ---- Daftar Pending (per item) ----
  let pending = $state<PendingItem[]>([]);
  let activeItemId = $state('');
  let pendingEl = $state<HTMLElement | undefined>(undefined);
  let pendingSeq = 0;

  // ---- Blok bawah: input Barcode No ----
  let barcodeInput = $state('');
  let barcodeMessage = $state('');
  let barcodeOk = $state(false);

  const activeItem = $derived(pending.find((p) => p.id === activeItemId) ?? null);
  const hasActiveItem = $derived(activeItem !== null);
  /** Target commit barcode: item aktif, bila tidak ada -> item pertama. */
  const targetItem = $derived(activeItem ?? pending[0] ?? null);
  /** Sudah ada simpanan sukses -> tabel menampilkan kolom Barcode No. */
  const anySaved = $derived(pending.some((p) => p.savedBarcodes.length > 0));
  /** Ada barcode terisi yang belum tersimpan. */
  const hasUnsavedBarcodes = $derived(pending.some((p) => p.slots.some((s) => s.trim())));
  /** Simpan Semua hanya dinonaktifkan setelah simpanan sukses dan tak ada barcode baru. */
  const saveBlocked = $derived(anySaved && !hasUnsavedBarcodes);

  // ---- Kamera: html5-qrcode ----
  type CameraFacing = 'environment' | 'user';

  const SCANNER_ELEMENT_ID = 'barcode-scanner-region';

  // EAN-13 untuk barcode 13 digit, Code 128 / Code 39 sebagai cadangan
  const SCAN_FORMATS = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39
  ];

  const SCAN_CONFIG: Html5QrcodeCameraScanConfig = {
    fps: 10,
    // area bidik: lebar penuh, tinggi ~45% (barcode 1D butuh kotak melebar)
    qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
      width: Math.max(50, Math.min(Math.floor(viewfinderWidth * 0.9), viewfinderWidth)),
      height: Math.max(50, Math.min(Math.floor(viewfinderHeight * 0.45), viewfinderHeight))
    })
  };

  let scannerOpen = $state(false);
  let scannerStarting = $state(false);
  let scannerError = $state('');
  let cameraFacing = $state<CameraFacing>('environment');

  let scanner: Html5Qrcode | null = null;
  // token pembatalan: mencegah start yang masih tertunda meninggalkan stream kamera
  let scannerRun = 0;
  let scanHandled = false;
  let lastScanText = '';
  let lastScanAt = 0;

  const fieldMeta = $derived(
    SEARCH_FIELDS.find((f) => f.value === searchField) ?? SEARCH_FIELDS[2]
  );

  // R1: filter hasil di sisi client (query baris sudah memakai .eq saat kategori dipilih)
  const filteredResults = $derived(
    selectedCategory
      ? results.filter((r) => (r.category_name ?? '') === selectedCategory)
      : results
  );

  onMount(async () => {
    try {
      const { data, error } = await supabase.from('v_barcode_categories').select('category_name');
      if (error) throw error;
      categories = (data ?? [])
        .map((r: { category_name: string | null }) => r.category_name)
        .filter((c): c is string => Boolean(c))
        .sort((a, b) => a.localeCompare(b, 'id'));
    } catch (err) {
      // view belum ada / gagal -> cukup tampilkan "Semua Kategori"
      console.error('Gagal memuat kategori:', err);
      categories = [];
    } finally {
      categoriesLoaded = true;
    }
  });

  // kunci scroll body selama modal kamera terbuka
  $effect(() => {
    if (!scannerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });

  onDestroy(() => {
    // navigasi tinggalkan halaman: hentikan stream kamera juga
    scannerRun++;
    const instance = scanner;
    scanner = null;
    if (!instance) return;
    try {
      void instance.stop().catch(() => undefined);
    } catch {
      // scanner tidak sedang berjalan
    }
    try {
      instance.clear();
    } catch {
      // sudah bersih
    }
  });

  function resetSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = null;
    suggestions = [];
    showSuggestions = false;
    results = [];
    selectedValue = '';
    barcodeInput = '';
    barcodeMessage = '';
    barcodeOk = false;
  }

  function setSearchField(field: SearchField) {
    if (searchField === field) return;
    searchField = field;
    searchQuery = '';
    resetSearch();
  }

  async function onSearchInput() {
    resetSearch();

    const q = searchQuery.trim();
    if (q.length < 2) return;

    searchTimeout = setTimeout(async () => {
      try {
        loadingResults = true;
        let query = supabase
          .from('barcode_items')
          .select(searchField)
          .ilike(searchField, `%${q}%`);
        if (selectedCategory) query = query.eq('category_name', selectedCategory);
        const { data, error } = await query.limit(20);

        if (error) throw error;

        const distinct = [
          ...new Set(
            (data ?? []).map((r: Record<string, string>) => r[searchField]).filter(Boolean)
          )
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

  async function loadResults(value: string) {
    try {
      loadingResults = true;
      let query = supabase
        .from('barcode_items')
        .select('item_no, barcode_no, description, category_name')
        .eq(searchField, value);
      if (selectedCategory) query = query.eq('category_name', selectedCategory);
      const { data, error } = await query.order('item_no');

      if (error) throw error;
      results = (data ?? []) as BarcodeRow[];
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal memuat data', text: err.message });
    } finally {
      loadingResults = false;
    }
  }

  function selectValue(value: string) {
    selectedValue = value;
    showSuggestions = false;
    suggestions = [];
    barcodeInput = '';
    barcodeMessage = '';
    barcodeOk = false;
    clearSavedRows(); // pencarian baru: baris tersimpan dibuang dari pending
    loadResults(value);
  }

  /**
   * Pencarian baru (user memilih saran di kartu pencarian): baris yang sudah
   * tersimpan dibuang dari daftar pending. Item yang BELUM tersimpan tidak
   * pernah dibuang — hanya snapshot `savedBarcodes`-nya yang dikosongkan,
   * dan item yang seluruh barcode-nya sudah tersimpan (tanpa barcode baru)
   * hilang beserta barisnya.
   */
  function clearSavedRows() {
    if (!anySaved) return;
    const kept: PendingItem[] = [];
    for (const p of pending) {
      if (p.savedBarcodes.length === 0) {
        kept.push(p); // belum pernah tersimpan -> tetap di pending
        continue;
      }
      p.savedBarcodes = []; // baris tersimpan dibuang
      if (p.slots.some((s) => s.trim())) kept.push(p); // masih ada barcode belum tersimpan -> tetap
    }
    pending = kept;
    if (!kept.some((p) => p.id === activeItemId)) activeItemId = kept[0]?.id ?? '';
  }

  // R1: ganti kategori -> tarik ulang baris untuk nilai yang sedang dipilih
  function onCategoryChange() {
    if (selectedValue) loadResults(selectedValue);
  }

  function makeItemId(): string {
    pendingSeq += 1;
    return `item-${pendingSeq}`;
  }

  /** Blok atas: hanya satu item yang aktif pada satu waktu. */
  function setActive(itemId: string) {
    if (pending.some((p) => p.id === itemId)) activeItemId = itemId;
  }

  function removeSlot(itemId: string, index: number) {
    const item = pending.find((p) => p.id === itemId);
    if (!item) return;
    item.slots.splice(index, 1);
  }

  /**
   * Dorong satu entri pending baru dari baris hasil pencarian (dipakai tombol
   * "Add Barcode"). Hanya METADATA item yang disalin — barcode lama dari hasil
   * pencarian TIDAK pernah ikut; item mulai dengan slot kosong internal saja
   * (tidak dirender), barcode diisi manual lewat Blok bawah.
   */
  function createPendingItem(row: BarcodeRow): PendingItem {
    const item: PendingItem = {
      id: makeItemId(),
      item_no: row.item_no,
      description: row.description,
      category_name: row.category_name ?? '',
      slots: [''],
      savedBarcodes: []
    };
    pending.push(item);
    return item;
  }

  /** Isi slot kosong TERAKHIR milik item; bila tidak ada, buat satu slot baru. */
  function fillSlot(item: PendingItem, value: string): void {
    for (let i = item.slots.length - 1; i >= 0; i--) {
      if (!item.slots[i].trim()) {
        item.slots[i] = value;
        return;
      }
    }
    item.slots.push(value);
  }

  /**
   * Tombol "Add Barcode": semua baris hasil dikelompokkan per item_no, lalu
   * hanya MEMASTIKAN tiap item ada di daftar pending — barcode lama dari
   * hasil pencarian tidak pernah disalin ke slot. Item yang sudah ada di
   * pending dibiarkan apa adanya (apa pun yang sudah diketik user tetap).
   */
  async function addAllToPending() {
    const groups = new Map<string, BarcodeRow[]>();
    for (const row of filteredResults) {
      const list = groups.get(row.item_no);
      if (list) list.push(row);
      else groups.set(row.item_no, [row]);
    }

    let firstNewId = '';
    for (const [itemNo, rows] of groups) {
      if (pending.some((p) => p.item_no === itemNo)) continue; // sudah ada -> jangan diubah

      const item = createPendingItem(rows[0]);
      if (!firstNewId) firstNewId = item.id;
    }

    if (firstNewId) activeItemId = firstNewId;
    else if (!hasActiveItem) activeItemId = pending[0]?.id ?? '';

    barcodeInput = '';
    barcodeMessage = '';
    barcodeOk = false;

    await tick();
    pendingEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Blok bawah -> slot barcode: input 100% manual, tanpa lookup apa pun.
   * - Mengetik TIDAK PERNAH mengunci; commit hanya lewat tombol "Tambah
   *   Barcode", Enter, atau pemindaian kamera — ketiganya memakai fungsi ini.
   * - Target: item aktif; bila tidak ada, item pertama di pending (otomatis).
   * - Satu-satunya pengecekan lokal: kode yang sudah tercatat di slot /
   *   snapshot pending tidak diduplikasi. Selebihnya diterima apa adanya
   *   (panjang/karakter bebas); konflik dengan database tetap ditangani
   *   validasi "Simpan Semua".
   */
  function commitBarcode() {
    const q = barcodeInput.trim();
    if (!q || !targetItem) return;

    const lower = q.toLowerCase();
    const already = pending.some(
      (p) =>
        p.slots.some((s) => s.trim().toLowerCase() === lower) ||
        p.savedBarcodes.some((s) => s.trim().toLowerCase() === lower)
    );
    if (already) {
      barcodeOk = false;
      barcodeMessage = 'Barcode sudah tercatat pada daftar pending.';
      barcodeInput = '';
      return;
    }

    fillSlot(targetItem, q);
    activeItemId = targetItem.id;
    barcodeOk = true;
    barcodeMessage = 'Barcode ditambahkan.';
    barcodeInput = '';
  }

  function onBarcodeKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitBarcode();
    }
  }

  /** Baris tabel untuk satu item: per barcode bila sudah ada simpanan, selalu satu baris minimal. */
  function tableRowsFor(item: PendingItem): string[] {
    if (!anySaved) return [''];
    const rows = [...item.savedBarcodes, ...item.slots.filter((s) => s.trim())];
    return rows.length > 0 ? rows : [''];
  }

  function itemLabel(item: PendingItem): string {
    return `${item.item_no} (${item.description})`;
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Terjemahkan pesan galat html5-qrcode / mediaDevices ke bahasa Indonesia. */
  function scannerErrorText(err: unknown): string {
    const msg = String((err as { message?: string })?.message ?? err ?? '');
    if (/NotAllowedError|Permission denied/i.test(msg)) {
      return 'Izin kamera ditolak. Aktifkan izin kamera di pengaturan browser, lalu coba lagi.';
    }
    if (/NotFoundError|Requested device not found|no camera|no video/i.test(msg)) {
      return 'Kamera tidak ditemukan pada perangkat ini.';
    }
    if (/NotReadableError|in use|Could not start video source/i.test(msg)) {
      return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
    }
    if (/OverconstrainedError/i.test(msg)) {
      return 'Kamera tidak mendukung pengaturan yang dipilih.';
    }
    if (/secure context|insecure/i.test(msg)) {
      return 'Akses kamera hanya tersedia lewat https atau localhost.';
    }
    if (/not supported|does(n't| not) support/i.test(msg)) {
      return 'Browser ini tidak mendukung pemindaian kamera.';
    }
    return msg ? `Gagal membuka kamera. ${msg}` : 'Gagal membuka kamera.';
  }

  /**
   * Hentikan satu instance scanner. `stop()` melempar error bila tidak sedang
   * scan, dan bisa menggantung bila track sudah kosong — dibatasi timeout.
   */
  async function stopInstance(instance: Html5Qrcode | null): Promise<void> {
    if (!instance) return;
    try {
      await Promise.race([instance.stop(), delay(2000)]);
    } catch {
      // tidak dalam keadaan scan — aman diabaikan
    }
  }

  /** Matikan kamera + buang instance (dipakai saat tutup, galat, dan onDestroy). */
  async function disposeScanner(): Promise<void> {
    scannerRun++;
    const instance = scanner;
    scanner = null;
    await stopInstance(instance);
    if (instance) {
      try {
        instance.clear();
      } catch {
        // sudah dibersihkan
      }
    }
  }

  async function startScanner(run: number): Promise<void> {
    const instance = scanner;
    if (!instance) return;
    try {
      await instance.start(
        { facingMode: cameraFacing },
        SCAN_CONFIG,
        onScanSuccess,
        onScanFailure
      );
      // start selesai setelah dibatalkan (misal tombol tutup ditekan) -> matikan lagi
      if (run !== scannerRun || !scannerOpen) {
        await stopInstance(instance);
      }
    } catch (err) {
      if (run !== scannerRun) return;
      scannerError = scannerErrorText(err);
      await stopInstance(instance);
    } finally {
      if (run === scannerRun) scannerStarting = false;
    }
  }

  async function onCameraScan() {
    if (scannerOpen) return;
    scannerOpen = true;
    scannerError = '';
    cameraFacing = 'environment'; // kamera belakang secara bawaan
    scanHandled = false;
    lastScanText = '';
    lastScanAt = 0;
    scannerStarting = true;

    await tick(); // tunggu #barcode-scanner-region ada di DOM

    const run = ++scannerRun;
    try {
      scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: SCAN_FORMATS,
        verbose: false
      });
    } catch (err) {
      scannerError = scannerErrorText(err);
      scannerStarting = false;
      return;
    }
    await startScanner(run);
  }

  /** Ganti kamera: stop() dulu, lalu start() ulang dengan facingMode berbeda. */
  async function switchCamera() {
    if (!scannerOpen || scannerStarting) return;
    cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    scannerStarting = true;
    scannerError = '';
    const run = ++scannerRun;
    await stopInstance(scanner);
    if (run !== scannerRun || !scannerOpen) return;
    await startScanner(run);
  }

  async function closeScanner() {
    await disposeScanner(); // stream dimatikan lebih dulu, baru UI ditutup
    scannerOpen = false;
    scannerStarting = false;
    scannerError = '';
  }

  function onScanSuccess(decodedText: string) {
    if (!scannerOpen || scanHandled) return;

    const value = (decodedText ?? '').trim();
    if (!value) return;

    // abaikan kode yang sama dalam ~2 detik selama scanner terbuka
    const now = Date.now();
    if (value === lastScanText && now - lastScanAt < 2000) return;

    lastScanText = value;
    lastScanAt = now;
    scanHandled = true;

    void (async () => {
      await disposeScanner(); // kamera langsung dimatikan
      scannerOpen = false;
      scannerStarting = false;
      scannerError = '';
      // jalur yang sama dengan tombol "Tambah Barcode"
      barcodeInput = value;
      commitBarcode();
    })();
  }

  function onScanFailure() {
    // dipanggil hampir tiap frame ketika tidak ada kode terbaca — abaikan
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && scannerOpen) void closeScanner();
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

    const itemsWithCodes = pending.filter((p) => p.slots.some((s) => s.trim()));
    const skippedItems = pending.filter((p) => !p.slots.some((s) => s.trim()));

    if (itemsWithCodes.length === 0) {
      await Swal.fire({
        icon: 'warning',
        title: 'Belum ada barcode',
        text: `Item berikut belum memiliki barcode: ${skippedItems.map(itemLabel).join('; ')}. Isi barcode terlebih dahulu.`,
        confirmButtonText: 'Oke'
      });
      return;
    }

    // flatten: satu entri pending -> satu baris per barcode terisi
    const flatRows = itemsWithCodes.flatMap((p) =>
      p.slots
        .filter((s) => s.trim())
        .map((s) => ({
          item_no: p.item_no,
          barcode_no: s.trim(),
          description: p.description,
          category_name: p.category_name
        }))
    );

    const trimmedNos = flatRows.map((r) => r.barcode_no);
    if (new Set(trimmedNos).size !== trimmedNos.length) {
      await Swal.fire({
        icon: 'error',
        title: 'Validasi gagal',
        text: 'Barcode No tidak boleh duplikat dalam satu batch pending.',
        confirmButtonText: 'Oke'
      });
      return;
    }

    // item tanpa barcode sama sekali: dilewati, user dikonfirmasi dulu
    if (skippedItems.length > 0) {
      const result = await Swal.fire({
        icon: 'warning',
        title: 'Item tanpa barcode',
        text: `Item berikut belum punya barcode dan akan dilewati: ${skippedItems
          .map(itemLabel)
          .join('; ')}. Simpan item lainnya?`,
        showCancelButton: true,
        confirmButtonText: 'Ya, simpan',
        cancelButtonText: 'Batal',
        confirmButtonColor: '#3b82f6'
      });
      if (!result.isConfirmed) return;
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

      const conflictRows = flatRows.filter((r) => existingNos.has(r.barcode_no));
      if (conflictRows.length > 0) {
        const rowList = conflictRows.map((r) => r.barcode_no).join(', ');
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

      const toInsert = flatRows.map((r) => ({
        item_no: r.item_no,
        barcode_no: r.barcode_no,
        description: r.description,
        category_name: r.category_name,
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

      // Baris TETAP di pending: slot terisi dipindahkan ke snapshot
      // `savedBarcodes` sehingga tabel menampilkan kolom Barcode No, dan
      // simpanan berikutnya hanya memuat barcode baru (tanpa konflik diri
      // sendiri terhadap added_barcodes). Item yang dilewati (tanpa barcode)
      // tidak tersentuh.
      for (const p of pending) {
        const filled = p.slots.filter((s) => s.trim());
        if (filled.length === 0) continue;
        p.savedBarcodes = [...p.savedBarcodes, ...filled];
        p.slots = p.slots.filter((s) => !s.trim());
      }
      results = [];
      selectedValue = '';
      searchQuery = '';
      barcodeInput = '';
      barcodeMessage = '';
      barcodeOk = false;
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Gagal menyimpan', text: err.message });
    } finally {
      saving = false;
    }
  }
</script>

<div class="space-y-6">
  <!-- 1. Kategori (di paling atas) -->
  <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
    <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <label for="category-filter" class="text-sm font-medium text-gray-700 shrink-0">
        Kategori
      </label>
      <select
        id="category-filter"
        bind:value={selectedCategory}
        onchange={onCategoryChange}
        class="w-full sm:w-auto sm:min-w-[240px] px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
      >
        <option value="">Semua Kategori</option>
        {#each categories as cat}
          <option value={cat}>{cat}</option>
        {/each}
      </select>
      {#if !categoriesLoaded}
        <span class="text-xs text-gray-400">Memuat kategori...</span>
      {/if}
    </div>
  </div>

  <!-- 2. Pencarian -->
  <div class="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
    <div
      class="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1 mb-4"
      role="group"
      aria-label="Kolom pencarian"
    >
      {#each SEARCH_FIELDS as field}
        <button
          type="button"
          onclick={() => setSearchField(field.value)}
          aria-pressed={searchField === field.value}
          class="px-3 sm:px-4 py-1.5 text-sm rounded-md transition-colors whitespace-nowrap {searchField ===
          field.value
            ? 'bg-white text-blue-700 font-medium shadow-sm'
            : 'text-gray-600 hover:text-gray-900'}"
        >
          {field.label}
        </button>
      {/each}
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center gap-4">
      <div class="w-full min-w-0">
        <label class="block text-sm font-medium text-gray-700 mb-2" for="search-input">
          Cari {fieldMeta.label}
        </label>
        <div class="relative">
          <input
            id="search-input"
            type="text"
            bind:value={searchQuery}
            oninput={onSearchInput}
            placeholder={fieldMeta.placeholder}
            class="w-full px-4 py-3 pr-28 sm:pr-32 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
          />
          {#if loadingResults}
            <div
              class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none"
            >
              <span class="text-[11px] leading-none text-blue-500 whitespace-nowrap">Mencari...</span>
              <span
                class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
              ></span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Suggestions -->
    {#if showSuggestions && suggestions.length > 0}
      <div class="mt-2 border border-gray-200 rounded-lg shadow-lg bg-white max-h-60 overflow-y-auto z-20">
        {#each suggestions as value}
          <button
            onclick={() => selectValue(value)}
            class="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0 {searchField ===
            'description'
              ? ''
              : 'font-mono'}"
          >
            {value}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- 3. Hasil pencarian -->
  {#if selectedValue}
    <div class="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-base sm:text-lg font-semibold text-gray-900 min-w-0 break-words">
          Hasil untuk:
          <span class="text-blue-600 font-mono">{selectedValue}</span>
        </h2>
        <div class="flex items-center gap-2 shrink-0">
          {#if selectedCategory}
            <span class="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-2 py-1 rounded">
              {selectedCategory}
            </span>
          {/if}
          <span class="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">
            {filteredResults.length} baris
          </span>
        </div>
      </div>

      {#if loadingResults}
        <div class="flex items-center justify-center gap-3 py-8 text-sm text-gray-500">
          <span class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
          Mencari...
        </div>
      {:else if filteredResults.length === 0}
        <p class="py-8 text-center text-sm text-gray-500">
          Tidak ada barcode untuk
          <span class="font-mono text-gray-700">{selectedValue}</span>
          {#if selectedCategory}
            pada kategori <span class="text-gray-700">{selectedCategory}</span>
          {/if}.
        </p>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-sm border-collapse">
            <thead>
              <tr class="text-left text-gray-500 border-b border-gray-200">
                <th class="pb-3 font-medium">Item No</th>
                <th class="pb-3 font-medium">Barcode No</th>
                <th class="pb-3 font-medium">Description</th>
                <th class="pb-3 font-medium">Category Name</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredResults as row}
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

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            onclick={addAllToPending}
            class="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
          >
            Add Barcode
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- 4. Daftar Pending: Blok atas (item) + Blok bawah (barcode) + Simpan Semua -->
  {#if pending.length > 0}
    <div
      bind:this={pendingEl}
      class="bg-blue-50 p-4 sm:p-6 rounded-xl shadow-sm border border-blue-100 scroll-mt-6"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 class="text-lg font-semibold text-blue-900">Daftar Pending ({pending.length})</h2>
      </div>
      <p class="mb-4 text-xs text-blue-700/80">
        Klik baris item untuk memilih, lalu pindai atau ketik barcode di bagian bawah.
      </p>

      <!-- Blok atas: daftar item -->
      <div class="bg-white rounded-xl border border-blue-100 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[600px] text-sm border-collapse">
            <thead>
              <tr class="text-left text-blue-700 border-b border-blue-200 bg-white">
                <th class="px-4 pt-3 pb-3 font-medium">Item No</th>
                <th class="px-4 pt-3 pb-3 font-medium">Description</th>
                <th class="px-4 pt-3 pb-3 font-medium">Category Name</th>
                {#if anySaved}
                  <th class="px-4 pt-3 pb-3 font-medium">Barcode No</th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#each pending as item (item.id)}
                {@const isActive = item.id === activeItemId}
                {#each tableRowsFor(item) as savedBarcode}
                  <tr
                    class="cursor-pointer border-b border-blue-50 transition-colors {isActive
                      ? 'bg-blue-100'
                      : 'hover:bg-blue-50'}"
                    onclick={() => setActive(item.id)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActive(item.id);
                      }
                    }}
                  >
                    <td
                      class="px-4 py-3 font-mono {isActive
                        ? 'border-l-4 border-blue-600 text-blue-900 font-medium'
                        : 'border-l-4 border-transparent text-gray-700'}"
                    >
                      {item.item_no}
                    </td>
                    <td class="px-4 py-3 text-gray-700">{item.description}</td>
                    <td class="px-4 py-3 text-gray-700">{item.category_name || '-'}</td>
                    {#if anySaved}
                      <td class="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">
                        {savedBarcode || '-'}
                      </td>
                    {/if}
                  </tr>
                {/each}

                {#if isActive}
                  <tr class="bg-blue-50/80 border-b border-blue-100">
                    <td colspan={anySaved ? 4 : 3} class="px-4 pt-1 pb-4">
                      <div class="flex flex-wrap items-center gap-2">
                        {#each item.slots as slot, slotIndex}
                          {#if slot.trim()}
                            <span
                              class="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-white border border-blue-200 rounded-full text-xs font-mono text-gray-800"
                            >
                              {slot}
                              <button
                                type="button"
                                onclick={() => removeSlot(item.id, slotIndex)}
                                title="Hapus barcode"
                                aria-label="Hapus barcode {slot}"
                                class="w-4 h-4 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-red-600 hover:bg-red-100 transition-colors"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="3"
                                  stroke-linecap="round"
                                  class="w-2.5 h-2.5"
                                  aria-hidden="true"
                                >
                                  <path d="M6 6l12 12M18 6L6 18" />
                                </svg>
                              </button>
                            </span>
                          {/if}
                        {/each}
                      </div>
                      {#if item.savedBarcodes.length === 0 && !item.slots.some((s) => s.trim())}
                        <p class="mt-2 text-xs text-gray-500">Belum ada barcode.</p>
                      {/if}
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Blok bawah: input Barcode No + kamera -->
      <div class="mt-4 bg-white rounded-xl border border-blue-100 p-4 sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 class="text-base font-semibold text-gray-900">Barcode No</h3>
          <span class="text-xs text-gray-400">Ketik manual atau pindai dengan kamera</span>
        </div>

        <div class="flex flex-col sm:flex-row gap-2">
          <div class="relative flex-1 min-w-0">
            <input
              id="barcode-input"
              type="text"
              bind:value={barcodeInput}
              oninput={() => {
                barcodeMessage = ''; // pesan commit lama tidak berlaku saat mengetik lagi
                barcodeOk = false;
              }}
              onkeydown={onBarcodeKeydown}
              placeholder="Masukkan barcode no..."
              class="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            {#if barcodeInput}
              <span
                class="absolute right-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-amber-400"
              ></span>
            {/if}
          </div>
          {#if barcodeInput.trim()}
            <button
              type="button"
              onclick={commitBarcode}
              class="shrink-0 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                class="w-5 h-5"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span class="text-sm font-medium">Tambah Barcode</span>
            </button>
          {/if}
          <button
            type="button"
            data-camera-scan
            title="Scan dengan kamera"
            aria-label="Scan dengan kamera"
            onclick={() => void onCameraScan()}
            class="shrink-0 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-5 h-5"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span class="text-sm font-medium">Kamera</span>
          </button>
        </div>

        {#if targetItem}
          <p class="mt-2 text-xs text-blue-700">
            Barcode akan masuk ke item
            <span class="font-mono font-medium">{targetItem.item_no}</span>
          </p>
        {/if}

        {#if barcodeMessage}
          <p class="mt-2 text-sm {barcodeOk ? 'text-emerald-600' : 'text-amber-600'}">
            {barcodeMessage}
          </p>
        {/if}
      </div>

      <!-- Simpan Semua -->
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          onclick={handleSave}
          disabled={saving || saveBlocked}
          class="w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-blue-600 disabled:bg-blue-300 hover:!bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed"
        >
          {saving ? 'Menyimpan...' : 'Simpan Semua'}
        </button>
      </div>
    </div>
  {/if}
</div>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Modal kamera (html5-qrcode) -->
{#if scannerOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/70 p-0 sm:p-6"
    role="dialog"
    aria-modal="true"
    aria-label="Pemindai barcode kamera"
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) void closeScanner();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') void closeScanner();
    }}
  >
    <div
      class="relative flex max-h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl sm:border sm:border-gray-100"
    >
      <!-- header -->
      <div
        class="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3"
      >
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-gray-900">Pemindai Kamera</h2>
          <p class="mt-0.5 text-xs text-gray-500">Arahkan kamera ke barcode</p>
        </div>
        <button
          type="button"
          title="Tutup"
          aria-label="Tutup pemindai"
          onclick={() => void closeScanner()}
          class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            class="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <!-- viewfinder -->
      <div class="relative flex min-h-[260px] items-center justify-center overflow-hidden bg-black">
        <div id="barcode-scanner-region" class="w-full"></div>

        {#if scannerStarting}
          <div
            class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center"
          >
            <span
              class="h-8 w-8 animate-spin rounded-full border-2 border-white/80 border-t-transparent"
            ></span>
            <p class="text-sm text-white">Membuka kamera...</p>
          </div>
        {:else if scannerError}
          <div
            class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-8 w-8 text-amber-400"
              aria-hidden="true"
            >
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <p class="text-sm text-white">{scannerError}</p>
          </div>
        {/if}
      </div>

      <!-- kontrol -->
      <div class="shrink-0 border-t border-gray-100 p-4">
        <div class="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onclick={() => void switchCamera()}
            disabled={scannerStarting}
            class="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M4 9a8 8 0 0 1 13.5-3.5L20 8" />
              <path d="M20 15a8 8 0 0 1-13.5 3.5L4 16" />
              <path d="M20 4v4h-4" />
              <path d="M4 20v-4h4" />
            </svg>
            {cameraFacing === 'environment' ? 'Gunakan Kamera Depan' : 'Gunakan Kamera Belakang'}
          </button>
          <button
            type="button"
            onclick={() => void closeScanner()}
            class="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:flex-none"
          >
            Tutup
          </button>
        </div>
        <p class="mt-3 text-center text-xs text-gray-400">
          Format yang didukung: EAN-13, Code 128, Code 39
        </p>
      </div>
    </div>
  </div>
{/if}
