<script setup lang="ts">
  const settings = useSettings();

  const spellsQuery = await useSpellsQuery();

  const spells = computed(() => {
    return spellsQuery.data.value.spells;
  });
</script>

<template>
  <div class="flex flex-col gap-12">
    <ul class="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-6">
      <SpellsItem v-for="edge in spells.edges" :key="edge.node.id" :spell="edge.node" />
    </ul>

    <div v-if="settings.relayMode === 'page'" class="self-center relative flex flex-row justify-center">
      <button class="button-primary w-32" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasPreviousPage" @click="spellsQuery.loadPreviousPage">
        ‹ Previous
      </button>

      <button class="button-primary w-32 ml-4" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadNextPage">
        Next ›
      </button>

      <span v-if="spellsQuery.isFetching.value" class="text-sm absolute top-1/2 -right-4 transform translate-x-full -translate-y-1/2">
        Loading…
      </span>
    </div>

    <div v-else class="flex flex-row justify-center space-x-4">
      <button class="button-primary" :disabled="spellsQuery.isFetching.value || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadMore">
        <span v-if="spellsQuery.isFetching.value">
          Loading…
        </span>

        <span v-else>
          Load more
        </span>
      </button>
    </div>
  </div>
</template>
