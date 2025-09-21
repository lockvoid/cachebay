<script setup lang="ts">
const props = defineProps({
  spell: {
    type: Object,
    required: true,
  }
});
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div class="md:col-span-2">
      <div class="relative w-full aspect-[16/9] overflow-hidden rounded-xl">
        <img
          v-if="props.spell.image"
          :src="props.spell.image"
          :alt="props.spell.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
          <span class="text-gray-500 text-3xl">✨</span>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4">
      <h1 class="text-2xl font-bold text-gray-900">{{ props.spell.name }}</h1>
      
      <p class="text-gray-700 leading-relaxed">{{ props.spell.effect }}</p>

      <div class="space-y-2 text-sm">
        <div class="flex">
          <span class="text-gray-500 w-20">Category:</span>
          <span class="text-gray-700">{{ props.spell.category }}</span>
        </div>
        <div class="flex">
          <span class="text-gray-500 w-20">Light:</span>
          <span class="text-gray-700">{{ props.spell.light || '—' }}</span>
        </div>
        <div v-if="props.spell.creator" class="flex">
          <span class="text-gray-500 w-20">Creator:</span>
          <span class="text-gray-700">{{ props.spell.creator }}</span>
        </div>
      </div>

      <div class="mt-4">
        <a v-if="props.spell.wiki" :href="props.spell.wiki" target="_blank" class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm transition">
          Open on Wiki
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
          </svg>
        </a>
      </div>
    </div>
  </div>
</template>
