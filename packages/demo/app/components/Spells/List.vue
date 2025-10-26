<script setup lang="ts">
  const settings = useSettings();

  const spellsPagination = useSpellsPagination();

  const spellsQuery = await useSpellsQuery();

  if (spellsQuery.error.value) {
    throw spellsQuery.error.value;
  }

  const spells = computed(() => {
    return spellsQuery.data.value.spells;
  });

  onUnmounted(() => {
    spellsPagination.resetPagination();
  });
</script>

<template>
  <div class="flex flex-col gap-12">
    <ul class="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:grid-cols-6">
      <SpellsItem v-for="edge in spells?.edges" :key="edge.node.id" :spell="edge.node" />
    </ul>

    <div v-if="settings.relayMode === 'page'" class="relative flex flex-row justify-center self-center">
      <button class="button-primary w-32" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasPreviousPage" @click="spellsQuery.loadPreviousPage">
        ‹ Previous
      </button>

      <button class="button-primary ml-4 w-32" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadNextPage">
        Next ›
      </button>

      <span v-if="spellsQuery.isFetching.value" class="absolute top-1/2 -right-4 translate-x-full -translate-y-1/2 transform text-sm">
        Loading…
      </span>
    </div>


    <div v-else class="flex flex-row justify-center space-x-4">
      <button class="button-primary" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadMore">
        <span v-if="spellsPagination.after && spellsQuery.isFetching.value">
          Loading…
        </span>

        <span v-else>
          Load more
        </span>
      </button>
      {{ spellsQuery.isFetching }}
    </div>
  </div>
</template>
