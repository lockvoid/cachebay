<script setup lang="ts">
  const settings = useSettings();

  const spellsActivity = useSpellsActivity();

  const spellsQuery = await useSpellsQuery();

  const spells = computed(() => {
    return spellsQuery.data.value.spells;
  });
</script>

<template>
  <div class="flex flex-col gap-6">
    <ul class="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-6">
      <SpellsItem v-for="edge in spells.edges" :key="edge.node.id" :spell="edge.node" />
    </ul>

    <div v-if="settings.relayMode === 'page'" class="flex flex-row justify-center space-x-4">
      <button
        @click="spellsQuery.loadPreviousPage()"
        :disabled="spellsActivity.isFetching || !spells.pageInfo.hasPreviousPage"
        class="button-secondary px-4 py-2 disabled:bg-gray-300 disabled:text-gray-500"
      >
        <span v-if="spellsActivity.isFetching">
          Loading…
        </span>

        <span v-else>
          ‹ Previous
        </span>
      </button>

      <button
        @click="spellsQuery.loadNextPage()"
        :disabled="spellsActivity.isFetching || !spells.pageInfo.hasNextPage"
        class="button-secondary px-4 py-2 disabled:bg-gray-300 disabled:text-gray-500"
      >
        <span v-if="spellsActivity.isFetching">
          Loading…
        </span>

        <span v-else>
          Next ›
        </span>
      </button>
    </div>

    <div v-else class="flex flex-row justify-center space-x-4">
      <button v-if="spells.pageInfo.hasNextPage" class="button-secondary self-center px-4 py-2 disabled:opacity-50" :disabled="spellsActivity.isFetching || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadMore">
        <span v-if="spellsActivity.isFetching">
          Loading…
        </span>

        <span v-else>
          Load more
        </span>
      </button>
    </div>
  </div>
</template>
