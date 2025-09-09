<script setup lang="ts">
  const colorsPagination = useColorsPagination();
</script>

<template>
  <header class="flex flex-col items-center gap-3">
    <div class="flex w-full md:w-2/5 lg:w-1/4 flex-row relative">
      <UiSearchInput v-model="colorsPagination.filters.query" />

      <div class="flex flex-row gap-2 absolute -right-6 translate-x-full -translate-y-1/2 top-1/2">
        <button class="a text-sm" @click="colorsPagination.clearFilters()" v-if="colorsPagination.filters.query">
          Clear filters
        </button>
      </div>
    </div>
  </header>
</template>
