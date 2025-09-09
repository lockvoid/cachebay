<script setup lang="ts">
  const colorsPagination = useColorsPagination();
</script>

<template>
  <header class="flex flex-col gap-3">
    <h2 class="text-2xl font-semibold">
      Colors
    </h2>

    <div class="flex items-center gap-3">
      <input v-model="colorsPagination.filters.query" type="text" placeholder="Search" class="w-64 px-3 py-2 rounded border focus:outline-none focus:ring" />

      <button class="px-3 py-2 rounded border hover:cursor-pointer" @click="colorsPagination.clearFilters()" v-if="colorsPagination.filters.query">
        Clear
      </button>
    </div>
  </header>
</template>
