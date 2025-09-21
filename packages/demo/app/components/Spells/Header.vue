<script setup lang="ts">
  const spellsPagination = useSpellsPagination();
</script>

<template>
  <header class="flex flex-col items-center gap-3">
    <div class="flex w-full md:w-2/5 lg:w-1/4 flex-row relative">
      <UiSearchInput v-model="spellsPagination.filters.query" />

      <div class="flex flex-row gap-2 absolute -right-6 translate-x-full -translate-y-1/2 top-1/2">
        <button class="text-sm text-gray-600 hover:text-gray-800 transition-colors" @click="spellsPagination.clearFilters()" v-if="spellsPagination.filters.query">
          Clear filters
        </button>
      </div>
    </div>
  </header>
</template>
