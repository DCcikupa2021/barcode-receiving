<script lang="ts">
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase';
  import Swal from 'sweetalert2';

  let email = '';
  let password = '';
  let role = 'leader';
  let loading = false;

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      await Swal.fire({
        icon: 'warning',
        title: 'Input diperlukan',
        text: 'Email dan password wajib diisi',
        confirmButtonText: 'Oke',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    loading = true;
    const { data, error } = await supabase.functions.invoke('create-user', {
      body: { email, password, role },
    });
    loading = false;

    if (error) {
      await Swal.fire({
        icon: 'error',
        title: 'Gagal membuat akun',
        text: error.message,
        confirmButtonText: 'Coba lagi',
        confirmButtonColor: '#ef4444',
      });
      return;
    }

    if (data?.error) {
      await Swal.fire({
        icon: 'error',
        title: 'Gagal membuat akun',
        text: data.error,
        confirmButtonText: 'Coba lagi',
        confirmButtonColor: '#ef4444',
      });
      return;
    }

    await Swal.fire({
      icon: 'success',
      title: 'Akun berhasil dibuat',
      text: `${email} (${role}) telah ditambahkan`,
      timer: 2000,
      showConfirmButton: false,
      toast: true,
      position: 'top-end',
    });

    email = '';
    password = '';
    role = 'leader';
  };
</script>

<svelte:head>
  <title>Pengaturan | Barcode Receiving</title>
</svelte:head>

<div class="max-w-lg mx-auto p-4">
  <div class="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900">Pengaturan</h1>
      <p class="text-gray-600 mt-1">Buat akun pengguna baru</p>
    </div>

    <form onsubmit={handleCreate} class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="contoh@mitra10.com"
          class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
          disabled={loading}
          required
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder="••••••••"
          class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
          disabled={loading}
          required
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1" for="role">
          Role
        </label>
        <select
          id="role"
          bind:value={role}
          class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all disabled:opacity-50"
          disabled={loading}
        >
          <option value="administrator">Administrator</option>
          <option value="admin">Admin</option>
          <option value="leader">Leader</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={loading}
        class="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {loading ? 'Memproses...' : 'Buat Akun'}
      </button>
    </form>

    <div class="mt-6 pt-6 border-t border-gray-100">
      <p class="text-sm text-gray-500">
        Hanya role <strong>Administrator</strong> yang dapat membuat akun baru.
        Akun akan otomatis terverifikasi dan siap login.
      </p>
    </div>
  </div>
</div>

<style>
  .swal2-title { font-family: inherit; }
  .swal2-content { font-family: inherit; }
</style>