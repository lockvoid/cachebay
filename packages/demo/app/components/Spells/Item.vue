<script setup lang="ts">
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
      <div class="relative w-full aspect-square overflow-hidden rounded-lg group-hover:opacity-90 transition">
        <img
          v-if="props.spell.image"
          :src="props.spell.image"
          :alt="props.spell.name"
          class="w-full h-full object-cover"
        />
        <SpellLight v-else :colors="props.spell.light" />
      </div>

      <!-- Meta -->
      <div class="mt-3 text-center">
        <h3 class="text-sm font-semibold text-gray-900">{{ props.spell.name }}</h3>
        <p class="text-xs text-gray-600 mt-1">{{ props.spell.category }}</p>
      </div>
    </NuxtLink>
  </li>
</template>
