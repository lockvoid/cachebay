<script setup lang="ts">
  const settings = useSettings();

  const spellsActivity = useSpellsActivity();

  const spellsPagination = useSpellsPagination();

  const spellsQuery = await useSpellsQuery();

  console.log(spellsQuery);
  const spells = computed(() => {
    console.log(spellsQuery.data.value.spells);
    return spellsQuery.data.value.spells;
  });


  const loadMore = () => {
    if (!spells.value.pageInfo.hasNextPage) {
      return;
    }

    spellsPagination.setAfter(spells.value.pageInfo.endCursor);
  };
  /*
  <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    <SpellsItem v-for="edge in spells.edges" :key="edge.node.id" :spell="edge.node" />
  </ul>

  <button v-if="spells.pageInfo.hasNextPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="spellsActivity.isFetching || !spells.pageInfo.hasNextPage" @click="loadMore">
    <span v-if="spellsActivity.isFetching">
      Loading…
    </span>

    <span v-else>
      Load more
    </span>
  </button>
  */
</script>

<template>
  <div class="flex flex-col gap-6">

  </div>
</template>
