<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { signIn } from '$lib/supabase';
  import Swal from 'sweetalert2';

  let email = '';
  let password = '';
  let loading = false;

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      await Swal.fire({
        icon: 'warning',
        title: 'Input diperlukan',
        text: 'Masukkan email dan password',
        confirmButtonText: 'Oke',
        confirmButtonColor: '#3b82f6'
      });
      return;
    }

    loading = true;
    const { error } = await signIn(email, password);
    loading = false;

    if (error) {
      await Swal.fire({
        icon: 'error',
        title: 'Login gagal',
        text: error.message,
        confirmButtonText: 'Coba lagi',
        confirmButtonColor: '#ef4444'
      });
      return;
    }

    await Swal.fire({
      icon: 'success',
      title: 'Login berhasil',
      text: 'Selamat datang!',
      timer: 1500,
      showConfirmButton: false,
      toast: true,
      position: 'top-end'
    });

    await goto(`${base}/barcode`);
  };
</script>

<svelte:head>
  <title>Login | Barcode Receiving</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
  <div class="max-w-md w-full">
    <div class="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Masuk</h1>
        <p class="text-gray-600 mt-2">Barcode Receiving — Mitra10</p>
      </div>

      <form onsubmit={handleLogin} class="space-y-4">
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
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {loading ? 'Memproses...' : 'Masuk'}
        </button>
      </form>

      <div class="mt-6 text-center text-sm text-gray-500">
        Mitra10 - DC Cikupa Apps
      </div>
    </div>
  </div>
</div>

<style>
  /* SweetAlert2 overrides untuk tema app */
  .swal2-title { font-family: inherit; }
  .swal2-content { font-family: inherit; }
</style>