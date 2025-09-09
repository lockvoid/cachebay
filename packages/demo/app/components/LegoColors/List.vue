<script setup lang="ts">
  const settings = useSettings();

  const colorsActivity = useColorsActivity();

  const colorsPagination = useColorsPagination();

  const colorsQuery = await useColorsQuery({ cachePolicy: settings.cachePolicy });

  const colors = computed(() => {
    return colorsQuery.data.value.colors;
  });

  const loadMore = () => {
    if (!colors.value.pageInfo.hasNextPage) {
      return;
    }

    colorsPagination.setAfter(colors.value.pageInfo.endCursor);
  };
</script>

<template>
  <div class="flex flex-col gap-6">
    <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <LegoColorsItem v-for="edge in colors.edges" :key="edge.node.id" :color="edge.node" />
    </ul>

    <button v-if="colors.pageInfo.hasNextPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="colorsActivity.isFetching || !colors.pageInfo.hasNextPage" @click="loadMore">
      <span v-if="colorsActivity.isFetching">
        Loading…
      </span>

      <span v-else>
        Load more
      </span>
    </button>
  </div>
</template>
