<script setup>
  const settings = useSettings();
</script>

<template>
  <header class="flex flex-row px-6 py-3">
    <AppLogo />

    <nav class="flex items-center gap-6 px-6 py-3">
      <AppNavLink to="/sets">
        Sets
      </AppNavLink>

      <AppNavLink to="/parts">
        Parts
      </AppNavLink>

      <AppNavLink to="/colors">
        Colors
      </AppNavLink>
    </nav>

    <div class="ml-auto flex items-center gap-3 px-6 py-3 text-sm bg-gray-100 rounded-full">
      <label class="flex items-center gap-2 text-sm">
        <span>Cache</span>

        <select v-model="settings.cachePolicy" class="bg-white border border-gray-300 rounded-md px-1 py-1">
          <option value="cache-and-network">Cache and Network</option>
          <option value="cache-first">Cache first</option>
          <option value="cache-only">Cache only</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-sm">
        <span>Relay</span>

        <select v-model="settings.relayMode" class="bg-white border border-gray-300 rounded-md px-1 py-1">
          <option value="append">Append mode</option>
          <option value="replace">Replace mode</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input v-model="settings.ssr" type="checkbox" id="dark-mode" />

        <span>SSR</span>
      </label>

      <label class="flex items-center gap-2 text-sm">
        <input v-model="settings.suspense" type="checkbox" id="dark-mode" />

        <span>Suspense</span>
      </label>
    </div>
  </header>
</template>
