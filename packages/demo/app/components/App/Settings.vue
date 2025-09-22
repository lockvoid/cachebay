<script setup lang="ts">
import IconsPotion from '~/components/Icons/Potion.vue';
import { onMounted, onUnmounted, ref } from 'vue';

const settings = useSettings();
const showSettings = ref(false);
const settingsRef = ref<HTMLElement | null>(null);

const handleClick = () => {
  showSettings.value = !showSettings.value;
};

const handleClickOutside = (event: MouseEvent) => {
  if (settingsRef.value && !settingsRef.value.contains(event.target as Node)) {
    showSettings.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="relative" ref="settingsRef">
    <button class="p-2 text-sm hover:text-blue-500 hover:cursor-pointer"@click="handleClick">
      Settings
    </button>

    <div v-show="showSettings" class="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg p-4 z-50 shadow-lg">
      <div class="flex flex-col space-y-4">
        <label class="flex flex-col gap-1.5 cursor-pointer group">
          <span class="text-gray-700 text-sm group-hover:text-gray-800 transition-colors">
            Cache Policy:
          </span>

          <select v-model="settings.cachePolicy" class="select">
            <option value="cache-first">
              Cache first
            </option>

            <option value="network-only">
              Network only
            </option>

            <option value="cache-and-network">
              Cache and Network
            </option>

            <option value="cache-only">
              Cache only
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1.5 cursor-pointer group">
          <span class="text-gray-700 text-sm group-hover:text-gray-800 transition-colors">
            Relay Mode:
          </span>

          <select v-model="settings.relayMode" class="select">
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
            <input v-model="settings.ssr" type="checkbox" />

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
</template>
