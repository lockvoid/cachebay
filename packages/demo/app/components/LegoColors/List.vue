<script setup lang="ts">
  const settings = useSettings();

  const legoColorsActivity = useLegoColorsActivity();

  const legoColorsPagination = useLegoColorsPagination();

  const legoColorsQuery = await useLegoColorsQuery({ cachePolicy: settings.cachePolicy.value });

  const legoColors = computed(() => {
    console.log(legoColorsQuery.data.value);

    return legoColorsQuery.data.value?.legoColors;
  });

  const count = ref(0);

  const loadMore = () => {
    if (!legoColors.value.pageInfo.hasNextPage) {
      return;
    }

    legoColorsPagination.setAfter(legoColors.value.pageInfo.endCursor);
  };

  onMounted(async () => {
    setInterval(async () => {
      count.value += 1;
    }, 100);
  });
</script>

<template>
  <div class="flex flex-col gap-2">
    <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <LegoColorsItem v-for="edge in legoColors.edges" :key="edge.node.id" :color="edge.node" />
    </ul>

    {{ count }}

    <button v-if="legoColors.pageInfo.hasNextPage" class="self-center px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50 hover:cursor-pointer" :disabled="legoColorsActivity.isFetching || !legoColors.pageInfo.hasNextPage" @click="loadMore">
      <span v-if="legoColorsActivity.isFetching">
        Loading…
      </span>

      <span v-else>
        Load more
      </span>
    </button>
  </div>
</template>
