<script setup lang="ts">
  const spellsPagination = useSpellsPagination();
</script>

<template>
  <header class="flex flex-col items-center gap-3">
    <div v-if="spellsPagination.filters.query" class="text-center">
      <button class="text-sm text-gray-600 hover:text-gray-800 transition-colors" @click="spellsPagination.clearFilters()">
        Clear filters
      </button>
    </div>
  </header>
</template>
