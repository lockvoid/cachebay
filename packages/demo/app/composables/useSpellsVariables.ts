export const useSpellsQueryVariables = () => {
  const pagination = useSpellsPagination();

  return computed(() => {
    const results: any = {};

    if (pagination.before) {
      Object.assign(results, { before: pagination.before, last: pagination.limit });
    } else {
      Object.assign(results, { after: pagination.after, first: pagination.limit });
    }

    if (pagination.filter.query) {
      if (!results.filter) {
        results.filter = {};
      }

      results.filter.query = pagination.filter.query;
    }

    if (pagination.filter.sort) {
      if (!results.filter) {
        results.filter = {};
      }

      results.filter.sort = pagination.filter.sort;
    }

    return results;
  });
};
