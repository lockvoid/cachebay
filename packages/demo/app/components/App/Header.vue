<script setup >
  const settings = useSettings();
</script>

<template>
  <header class=" flex bg-gray-800 text-white">
    <nav class="flex items-center gap-3 px-6 py-3">
      <NuxtLink to="/colors" class="underline">
        Colors
      </NuxtLink>
    </nav>

    <div class="flex items-center gap-3 px-6 py-3">
      <label class="flex items-center gap-2">
        <span>Cache policy</span>

        <select v-model="settings.cachePolicy" class="border border-gray-300 rounded-md px-3 py-2">
          <option value="cache-and-network">Cache and Network</option>
          <option value="cache-first">Cache first</option>
          <option value="cache-only">Cache only</option>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span>Relay</span>

        <select v-model="settings.relayMode" class="border border-gray-300 rounded-md px-3 py-2">
          <option value="append">Append mode</option>
          <option value="replace">Replace mode</option>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <input v-model="settings.ssr" type="checkbox" id="dark-mode" />

        <span>SSR</span>
      </label>

      <label class="flex items-center gap-2">
        <input v-model="settings.suspense" type="checkbox" id="dark-mode" />

        <span>Suspense</span>
      </label>
    </div>
  </header>
</template>
