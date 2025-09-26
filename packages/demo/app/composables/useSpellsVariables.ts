export const useSpellsQueryVariables = () => {
  const pagination = useSpellsPagination();

  return computed(() => {
    const results: any = {}

    if (pagination.before) {
      Object.assign(results, { before: pagination.before, last: pagination.limit });
    } else {
      Object.assign(results, { after: pagination.after, first: pagination.limit });
    }

    if (pagination.filter.query) {
      results.filter = {
        query: pagination.filter.query
      }
    }

    return results;
  });
};
