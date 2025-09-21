export const useSpellsQueryVariables = () => {
  const pagination = useSpellsPagination();

  return computed(() => {
    const results: any = {}

    if (pagination.after) {
      Object.assign(results, { after: pagination.after, first: pagination.limit });
    }

    if (pagination.before) {
      Object.assign(results, { before: pagination.before, last: pagination.limit });
    }

    if (pagination.filters.query) {
      results.filter = {
        query: pagination.filters.query
      }
    }

    return results;
  });
};
