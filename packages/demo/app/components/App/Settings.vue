<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { useSettings } from '../../composables/useSettings';

const settings = useSettings();
const showSettings = ref(false);

// Close settings when clicking outside
const settingsRef = ref<HTMLElement | null>(null);

onClickOutside(settingsRef, () => {
  showSettings.value = false;
});
</script>

<template>
  <div class="relative" ref="settingsRef">
    <!-- Settings Toggle -->
    <button 
      class="p-2 text-gray-600 hover:text-gray-800 transition-colors" 
      @click="showSettings = !showSettings"
      aria-label="Settings"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
      </svg>
    </button>

    <!-- Settings Panel -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div 
        v-show="showSettings" 
        class="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg p-4 z-50 shadow-lg"
      >
        <div class="flex flex-col space-y-4">
          <label class="flex flex-col gap-1.5 cursor-pointer group">
            <span class="text-gray-700 text-sm group-hover:text-gray-800 transition-colors">
              Cache Policy:
            </span>
            <select 
              v-model="settings.cachePolicy" 
              class="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500"
            >
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
            <select 
              v-model="settings.relayMode" 
              class="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-500"
            >
              <option value="infinite">infinite</option>
              <option value="page">page</option>
            </select>
          </label>

          <div class="flex items-center gap-3 text-xs">
            <label class="flex items-center gap-1.5 cursor-pointer group">
              <input 
                v-model="settings.ssr" 
                type="checkbox" 
                class="w-3 h-3 text-gray-600 bg-white border-gray-300 rounded focus:ring-gray-500 focus:ring-1" 
              />
              <span class="text-gray-700 group-hover:text-gray-800 transition-colors">
                SSR
              </span>
            </label>

            <label class="flex items-center gap-1.5 cursor-pointer group">
              <input 
                v-model="settings.optimistic" 
                type="checkbox" 
                class="w-3 h-3 text-gray-600 bg-white border-gray-300 rounded focus:ring-gray-500 focus:ring-1" 
              />
              <span class="text-gray-700 group-hover:text-gray-800 transition-colors">
                Optimistic
              </span>
            </label>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
