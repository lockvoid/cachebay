import { defineStore } from "pinia";

export const useSpellsPagination = defineStore("spellsPagination", () => {
  const after = ref<string | null>(null);
  const before = ref<string | null>(null);
  const limit = ref(10);

  const filter = reactive({
    query: "" as string,
    sort: "CREATE_DATE_DESC" as string,
  });

  const setQuery = (value: string) => {
    filter.query = value ?? "";
  };

  const setSort = (value: string) => {
    filter.sort = value ?? "CREATE_DATE_DESC";
  };

  const setAfter = (value: string | null) => {
    after.value = value ?? null;
    before.value = null;
  };

  const setBefore = (value: string | null) => {
    before.value = value ?? null;
    after.value = null;
  };

  const setLimit = (value: number) => {
    limit.value = value;
  };

  const resetPagination = () => {
    after.value = null;
    before.value = null;
  };

  const resetFilter = () => {
    filter.query = "";
    filter.sort = "CREATE_DATE_DESC";
  };

  const reset = () => {
    resetPagination();
    resetFilter();
  };

  watch(filter, () => {
    resetPagination();
  });

  return {
    limit,
    after,
    before,
    filter,
    setAfter,
    setBefore,
    setLimit,
    setQuery,
    setSort,
    resetPagination,
    resetFilter,
    reset,
  };
});

export const useSpellsActivity = defineStore("spellsActivity", () => {
  const state = reactive({ isFetching: false });

  return state;
});
