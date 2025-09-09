<script setup lang="ts">
  const colorsPagination = useColorsPagination();
</script>

<template>
  <header class="flex flex-col gap-3">
    <h2 class="text-2xl font-semibold">
      Colors
    </h2>

    <div class="flex flex-row items-center gap-3">
      <UiSearchInput v-model="colorsPagination.filters.query" />

      <button class="rounded underline underline-offset-4 hover:cursor-pointer" @click="colorsPagination.clearFilters()" v-if="colorsPagination.filters.query">
        Clear filters
      </button>
    </div>
  </header>
</template>
