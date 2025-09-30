<script setup lang="ts">
  import VoldemortWand from "~/components/Icons/VoldemortWand.vue";

  const props = defineProps({
    spell: {
      type: Object,
      required: true,
    },
  });
</script>

<template>
  <li class="group">
    <NuxtLink :to="`/spells/${props.spell.id}`" class="block">
      <div class="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white transition group-hover:opacity-90">
        <img v-if="props.spell.imageUrl" :src="props.spell.imageUrl" class="h-full w-full object-cover">

        <VoldemortWand v-else class="h-24 w-24 text-gray-500" />
      </div>

      <div class="mt-3 text-center">
        <h3 class="text-sm font-semibold">
          {{ props.spell.name }}
        </h3>

        <p class="mt-1 text-sm text-gray-500">
          {{ props.spell.category }}
        </p>
      </div>
    </NuxtLink>
  </li>
</template>
