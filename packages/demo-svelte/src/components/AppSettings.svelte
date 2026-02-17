<script lang="ts">
  import { getSettings } from "$lib/stores/settings.svelte";

  const settings = getSettings();

  let showSettings = $state(false);
  let settingsEl: HTMLDivElement;

  const handleClick = () => {
    showSettings = !showSettings;
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (settingsEl && !settingsEl.contains(event.target as Node)) {
      showSettings = false;
    }
  };

  $effect(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("click", handleClickOutside);

      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }
  });

  const setCachePolicy = (e: Event) => {
    settings.cachePolicy = (e.target as HTMLSelectElement).value;
    settings.reload();
  };

  const setRelayMode = (e: Event) => {
    settings.relayMode = (e.target as HTMLSelectElement).value;
    settings.reload();
  };

  const setSsr = (e: Event) => {
    settings.ssr = (e.target as HTMLInputElement).checked;
    settings.reload();
  };

  const setOptimistic = (e: Event) => {
    settings.optimistic = (e.target as HTMLInputElement).checked;
    settings.reload();
  };
</script>

<div class="relative" bind:this={settingsEl}>
  <button class="p-2 text-sm hover:cursor-pointer hover:text-blue-500" onclick={handleClick}>
    Settings
  </button>

  <div class="absolute top-full right-0 z-50 mt-2 w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-lg" class:hidden={!showSettings}>
    <div class="flex flex-col space-y-4">
      <label class="group flex cursor-pointer flex-col gap-1.5">
        <span class="text-sm text-gray-700 transition-colors group-hover:text-gray-800">
          Cache Policy:
        </span>

        <select value={settings.cachePolicy} onchange={setCachePolicy} class="select">
          <option value="cache-first">Cache first</option>
          <option value="network-only">Network only</option>
          <option value="cache-and-network">Cache and Network</option>
        </select>
      </label>

      <label class="group flex cursor-pointer flex-col gap-1.5">
        <span class="text-sm text-gray-700 transition-colors group-hover:text-gray-800">
          Relay Mode:
        </span>

        <select value={settings.relayMode} onchange={setRelayMode} class="select">
          <option value="infinite">Infinite</option>
          <option value="page">Page</option>
        </select>
      </label>

      <div class="flex items-center gap-3 text-xs">
        <label class="group flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={settings.ssr} onchange={setSsr} />
          <span class="text-gray-700 transition-colors group-hover:text-gray-800">SSR</span>
        </label>

        <label class="group flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={settings.optimistic} onchange={setOptimistic} class="h-3 w-3 rounded border-gray-300 bg-white text-gray-600 focus:ring-1 focus:ring-gray-500" />
          <span class="text-gray-700 transition-colors group-hover:text-gray-800">Optimistic</span>
        </label>
      </div>
    </div>
  </div>
</div>
