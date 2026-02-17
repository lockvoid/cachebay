<script lang="ts">
  import "../app.css";
  import { setCachebay } from "cachebay/svelte";
  import { createCachebayInstance } from "$lib/cachebay";
  import { getSettings } from "$lib/stores/settings.svelte";
  import AppHeader from "../components/AppHeader.svelte";

  let { children } = $props();

  const settings = getSettings();
  const cachebay = createCachebayInstance(settings.cachePolicy);

  setCachebay(cachebay);

  if (typeof window !== "undefined") {
    (window as any).CACHEBAY = cachebay;
  }
</script>

<AppHeader />

<div class="flex flex-col font-serif">
  {@render children()}
</div>
