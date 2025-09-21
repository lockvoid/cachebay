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
    <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <SpellsItem v-for="edge in spells.edges" :key="edge.node.id" :spell="edge.node" />
    </ul>

    <div v-if="settings.relayMode === 'page'" class="flex flex-row justify-center space-x-4">
      <button v-if="spells.pageInfo.hasPreviousPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="spellsActivity.isFetching || !spells.pageInfo.hasPreviousPage" @click="spellsQuery.loadPreviousPage">
        <span v-if="spellsActivity.isFetching">
          Loading…
        </span>

        <span v-else>
          ‹ Previous
        </span>
      </button>

      <button v-if="spells.pageInfo.hasNextPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="spellsActivity.isFetching || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadNextPage">
        <span v-if="spellsActivity.isFetching">
          Loading…
        </span>

        <span v-else>
          Next ›
        </span>
      </button>
    </div>

    <div v-else class="flex flex-row justify-center space-x-4">
      <button v-if="spells.pageInfo.hasNextPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="spellsActivity.isFetching || !spells.pageInfo.hasNextPage" @click="spellsQuery.loadMore">
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
