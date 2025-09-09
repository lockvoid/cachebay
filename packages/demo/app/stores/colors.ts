import { defineStore } from 'pinia';

export const useColorsPagination = defineStore('colorsPagination', () => {
  const after = ref(null);
  const first = ref(10);

  const filters = reactive({
    query: '' as string,
  });

  const setQuery = (value: string) => {
    filters.query = value ?? '';
  }

  const setAfter = (value: string | null) => {
    after.value = value ?? null;
  }

  const resetPagination = () => {
    after.value = null;
  }

  const setFirst = (value: number) => {
    first.value = value;
  }

  const clearFilters = () => {
    filters.query = '';
  }

  watch(filters, () => {
    resetPagination();
  });

  return {
    first,
    after,
    filters,
    setAfter,
    setFirst,
    setQuery,
    resetPagination,
    clearFilters,
  };
});

export const useColorsActivity = defineStore('colorsActivity', () => {
  const state = reactive({ isFetching: false })

  return state;
});
