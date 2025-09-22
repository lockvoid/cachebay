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
      <div class="relative w-full aspect-square overflow-hidden rounded-lg group-hover:opacity-90 transition bg-white flex items-center justify-center">
        <img v-if="props.spell.imageUrl" :src="props.spell.imageUrl" class="w-full h-full object-cover" />

        <VoldemortWand v-else class="w-24 h-24 text-gray-500" />
      </div>

      <div class="mt-3 text-center">
        <h3 class="text-sm font-semibold">
          {{ props.spell.name }}
        </h3>

        <p class="text-sm text-gray-500 mt-1">
          {{ props.spell.category }}
        </p>
      </div>
    </NuxtLink>
  </li>
</template>
