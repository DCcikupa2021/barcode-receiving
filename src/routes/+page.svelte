<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { getSession } from '$lib/supabase';

  onMount(async () => {
    const session = await getSession();
    await goto(session ? `${base}/barcode` : `${base}/login`, { replaceState: true });
  });
</script>

<div class="flex h-screen items-center justify-center bg-gray-50">
  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
</div>
