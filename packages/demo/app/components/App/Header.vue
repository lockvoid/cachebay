<script setup>
  const settings = useSettings();
</script>

<template>
  <header class="relative bg-white border-b border-gray-200 shadow-sm">
    <div class="relative flex flex-row items-center px-6 py-4">
      <AppLogo />

      <div class="ml-auto flex items-center gap-4 px-6 py-3 bg-gray-50 border border-gray-200 rounded-xl shadow-sm">
        <label class="flex items-center gap-2 text-xs">
          <span class="text-gray-700 font-medium">
            Cache
          </span>

          <select v-model="settings.cachePolicy" class="bg-white border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none">
            <option value="cache-and-network">
              Cache & Network
            </option>

            <option value="cache-first">
              Cache First
            </option>

            <option value="cache-only">
              Cache Only
            </option>
          </select>
        </label>

        <label class="flex items-center gap-2 text-xs">
          <span class="text-gray-700 font-medium">
            Relay
          </span>

          <select v-model="settings.relayMode" class="bg-white border border-gray-300 rounded-md px-2 py-1 text-xs text-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 focus:outline-none">
            <option value="infinite">
              Infinite
            </option>

            <option value="page">
              Page
            </option>
          </select>
        </label>

        <div class="flex items-center gap-3 text-xs">
          <label class="flex items-center gap-1.5 cursor-pointer group">
            <input v-model="settings.ssr" type="checkbox" class="w-3 h-3 text-gray-600 bg-white border-gray-300 rounded focus:ring-gray-500 focus:ring-1" />

            <span class="text-gray-700 group-hover:text-gray-800 transition-colors">
              SSR
            </span>
          </label>

          <label class="flex items-center gap-1.5 cursor-pointer group">
            <input v-model="settings.optimistic" type="checkbox" class="w-3 h-3 text-gray-600 bg-white border-gray-300 rounded focus:ring-gray-500 focus:ring-1" />

            <span class="text-gray-700 group-hover:text-gray-800 transition-colors">
              Optimistic
            </span>
          </label>
        </div>
      </div>
    </div>
  </header>
</template>
