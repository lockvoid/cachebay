import { defineStore } from 'pinia';

export const useSpellsPagination = defineStore('spellsPagination', () => {
  const after = ref<string | null>(null);
  const before = ref<string | null>(null);
  const limit = ref(10);

  const filters = reactive({
    query: '' as string,
  });

  const setQuery = (value: string) => {
    filters.query = value ?? '';
  }

  const setAfter = (value: string | null) => {
    after.value = value ?? null;
    before.value = null;
  }

  const setBefore = (value: string | null) => {
    before.value = value ?? null;
    after.value = null;
  }

  const resetPagination = () => {
    after.value = null;
    before.value = null;
  }

  const setLimit = (value: number) => {
    limit.value = value;
  }

  const clearFilters = () => {
    filters.query = '';
  }

  watch(filters, () => {
    resetPagination();
  });

  return {
    limit,
    after,
    before,
    filters,
    setAfter,
    setBefore,
    setLimit,
    setQuery,
    resetPagination,
    clearFilters,
  };
});

export const useSpellsActivity = defineStore('spellsActivity', () => {
  const state = reactive({ isFetching: false })

  return state;
});
