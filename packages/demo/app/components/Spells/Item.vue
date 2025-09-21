<script setup lang="ts">
import VoldemortWand from '~/components/Icons/VoldemortWand.vue';

const props = defineProps({
  spell: {
    type: Object,
    required: true,
  }
});
</script>

<template>
  <li class="group">
    <NuxtLink :to="`/spells/${props.spell.id}`" class="block">
      <!-- Image -->
      <div class="relative w-full aspect-square overflow-hidden rounded-lg group-hover:opacity-90 transition bg-gray-100 flex items-center justify-center">
        <img
          v-if="props.spell.image"
          :src="props.spell.image"
          :alt="props.spell.name"
          class="w-full h-full object-cover"
        />
        <VoldemortWand v-else class="w-16 h-16 text-gray-400" />
      </div>

      <!-- Meta -->
      <div class="mt-3 text-center">
        <h3 class="text-sm font-semibold text-gray-900">{{ props.spell.name }}</h3>
        <p class="text-xs text-gray-600 mt-1">{{ props.spell.category }}</p>
      </div>
    </NuxtLink>
  </li>
</template>
