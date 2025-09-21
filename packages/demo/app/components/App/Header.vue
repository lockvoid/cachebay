<script setup lang="ts">
  const settings = useSettings();
  const spellsPagination = useSpellsPagination();
  const showSettings = ref(false);
</script>

<template>
  <div class="flex items-center justify-between p-4 bg-white border-b border-gray-200">
    <div class="flex items-center gap-4">
      <NuxtLink to="/" class="flex items-center gap-2 text-xl font-bold text-gray-900 hover:text-gray-700 transition-colors">
        <!-- Harry Potter Hat SVG -->
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C8.5 2 6 4.5 6 8c0 1.5.5 3 1.5 4.5L12 22l4.5-9.5C17.5 11 18 9.5 18 8c0-3.5-2.5-6-6-6zm0 2c2.5 0 4 1.5 4 4 0 1-.3 2-.8 3L12 18l-3.2-7C8.3 10 8 9 8 8c0-2.5 1.5-4 4-4z"/>
          <circle cx="12" cy="8" r="2" fill="currentColor"/>
          <path d="M6 8c-1 0-2 .5-2 1.5S5.5 11 6.5 11 8 10.5 8 9.5 7 8 6 8zm12 0c1 0 2 .5 2 1.5s-.5 1.5-1.5 1.5S17 10.5 17 9.5 18 8 18 8z"/>
        </svg>
        Harry Potter's Spellbook
      </NuxtLink>
    </div>

    <!-- Search Bar -->
    <div class="flex-1 max-w-md mx-4 hidden md:block">
      <UiSearchInput v-model="spellsPagination.filters.query" />
    </div>

    <div class="flex items-center gap-4">
      <!-- Mobile Search Toggle -->
      <button class="md:hidden p-2 text-gray-600 hover:text-gray-800" @click="showSettings = !showSettings">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
      </button>

      <!-- Settings Toggle -->
      <div class="relative" @mouseenter="showSettings = true" @mouseleave="showSettings = false">
        <button class="p-2 text-gray-600 hover:text-gray-800 transition-colors" @click="showSettings = !showSettings">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
          </svg>
        </button>

        <!-- Settings Panel -->
        <div v-show="showSettings" class="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg p-4 z-50">
          <div class="flex flex-col space-y-4">
            <label class="flex flex-col gap-1.5 cursor-pointer group">
              <span class="text-gray-700 text-sm group-hover:text-gray-800 transition-colors">
                Cache Policy:
              </span>
              <select v-model="settings.cachePolicy" class="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500">
                <option value="cache-first">cache-first</option>
                <option value="cache-and-network">cache-and-network</option>
                <option value="network-only">network-only</option>
                <option value="cache-only">cache-only</option>
              </select>
            </label>

            <label class="flex flex-col gap-1.5 cursor-pointer group">
              <span class="text-gray-700 text-sm group-hover:text-gray-800 transition-colors">
                Relay Mode:
              </span>
              <select v-model="settings.relayMode" class="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500">
                <option value="infinite">infinite</option>
                <option value="page">page</option>
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
      </div>
    </div>
  </div>

  <!-- Mobile Search Bar -->
  <div v-show="showSettings" class="md:hidden p-4 border-b border-gray-200 bg-gray-50">
    <UiSearchInput v-model="spellsPagination.filters.query" />
  </div>
</template>
