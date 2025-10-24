<script setup lang="ts">
  import IconsDeathlyHallows from "~/components/Icons/DeathlyHallows.vue";
</script>

<template>
  <div class="flex items-center gap-3">
    <IconsDeathlyHallows class="h-10 w-10 flex-shrink-0 text-gray-800 transition-colors hover:text-gray-600" />

    <div class="flex flex-col">
      <h1 class="hidden font-serif text-xl font-bold text-gray-800 sm:block">
        Harry Potter's Spellbook
      </h1>

      <AppHogwartsTime />
    </div>
  </div>
</template>
