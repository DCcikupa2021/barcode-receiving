<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';

  goto(`${base}/barcode`);
</script>

<div class="flex h-screen items-center justify-center bg-gray-50">
  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
</div>