export const useSpellsQueryVariables = () => {
  const pagination = useSpellsPagination();

  return computed(() => {
    const results: any = {
      after: pagination.after,
      first: pagination.first,
    }

    if (pagination.filters.query) {
      results.filter = {
        query: pagination.filters.query
      }
    }

    return results;
  });
};
