<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import '../app.css';
  import { type Session } from '@supabase/supabase-js';
  import { supabase, getSession, onAuthStateChange, signOut } from '$lib/supabase';
  import Swal from 'sweetalert2';

  let session: Session | null = null;
  let subscription: { unsubscribe: () => void } | null = null;
  let sidebarOpen = false;
  let authChecked = false;
  let userRole: string | null = null;

  const toggleSidebar = () => {
    sidebarOpen = !sidebarOpen;
  };

  const isActive = (path: string) => $page.url.pathname === `${base}${path}`;

  const routePath = () => {
    const p = $page.url.pathname;
    return base && p.startsWith(base) ? p.slice(base.length) || '/' : p;
  };

  const handleLogout = async () => {
    const confirmed = await Swal.fire({
      icon: 'question',
      title: 'Keluar?',
      text: 'Yakin ingin keluar dari aplikasi?',
      showCancelButton: true,
      confirmButtonText: 'Ya, keluar',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      reverseButtons: true
    });

    if (confirmed.isConfirmed) {
      await signOut();
      await goto(`${base}/login`);
    }
  };

  const fetchUserRole = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
    userRole = data?.role ?? null;
  };

  const checkAuth = async () => {
    session = await getSession();
    authChecked = true;

    if (session?.user) {
      await fetchUserRole(session.user.id);
    }

    const path = routePath();
    if (!session && path !== '/login') {
      await goto(`${base}/login`);
    } else if (session && path === '/login') {
      await goto(`${base}/barcode`);
    }
  };

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${base}/service-worker.js`);
    }

    checkAuth();

    subscription = onAuthStateChange((event: string, newSession: Session | null) => {
      session = newSession ?? null;
      const path = routePath();

      if (newSession) {
        fetchUserRole(newSession.user.id);
      }

      if (event === 'SIGNED_OUT') {
        goto(`${base}/login`);
      } else if (!newSession && path !== '/login') {
        goto(`${base}/login`);
      } else if (newSession && path === '/login') {
        goto(`${base}/barcode`);
      }
    });

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  });
</script>

<svelte:head>
  <title>Barcode Receiving | Mitra10</title>
</svelte:head>

{#if !authChecked}
  <div class="fixed inset-0 flex items-center justify-center bg-gray-50">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
{:else}
  <div class="flex h-screen bg-gray-50">
    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-20 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out
             md:relative md:inset-y-0 md:translate-x-0
             {sidebarOpen ? 'translate-x-0' : '-translate-x-full'}"
    >
      <div class="flex items-center justify-between h-16 px-4 border-b border-gray-100">
        <h1 class="text-xl font-bold text-gray-900">Barcode</h1>
        {#if routePath() !== '/login'}
          <button
            onclick={toggleSidebar}
            class="text-gray-600 hover:text-gray-900 md:hidden"
            aria-label="Tutup sidebar"
          >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {/if}
      </div>

      <nav class="mt-4 px-3 space-y-1">
        <a
          href={`${base}/barcode`}
          class={`
            flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
            ${isActive('/barcode') ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}
          `}
        >
          <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Barcode
        </a>
        <a
          href={`${base}/detail`}
          class={`
            flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
            ${isActive('/detail') ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}
          `}
        >
          <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2z" />
          </svg>
          Detail
        </a>
        <a
          href={`${base}/history`}
          class={`
            flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
            ${isActive('/history') ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}
          `}
        >
          <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          History
        </a>
        {#if userRole === 'administrator'}
          <a
            href={`${base}/pengaturan`}
            class={`
              flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
              ${isActive('/pengaturan') ? 'bg-blue-100 text-blue-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'}`}
          >
            <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Pengaturan
          </a>
        {/if}
      </nav>
    </aside>

    <!-- Sidebar overlay mobile -->
    {#if sidebarOpen && routePath() !== '/login'}
      <div
        role="button"
        aria-label="Tutup sidebar"
        tabindex={0}
        onclick={toggleSidebar}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') toggleSidebar();
        }}
        class="fixed inset-0 z-10 bg-black opacity-50 transition-opacity duration-300 md:hidden"
      ></div>
    {/if}

    <!-- Main content -->
    <div class="flex-1 flex flex-col overflow-hidden md:ml-64">
      <!-- Topbar -->
      <header class="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <div class="flex items-center gap-2">
          {#if routePath() !== '/login'}
            <button
              onclick={toggleSidebar}
              class="text-gray-600 hover:text-gray-900 md:hidden"
              aria-label="Buka menu"
            >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {/if}
        </div>

        <div class="flex items-center gap-4">
          <span class="text-sm text-gray-700 hidden sm:block">
            {session?.user?.email ?? 'Pengguna'}
          </span>
          <button
            onclick={handleLogout}
            class="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1 rounded hover:bg-red-50 transition-colors"
          >
            Keluar
          </button>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto p-4">
        <slot />
      </main>
    </div>
  </div>
{/if}

<style>
  /* Tidak ada style tambahan, pakai Tailwind saja */
</style>