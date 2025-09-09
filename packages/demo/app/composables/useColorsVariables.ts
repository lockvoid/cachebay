export const useColorsQueryVariables = () => {
  const pagination = useColorsPagination();

  return computed(() => {
    const results = {
      after: pagination.after,
      first: pagination.first,
    }

    if (pagination.filters.query) {
      results.where = {
        name: {
          _ilike: `${pagination.filters.query}%`
        },
      }
    }

    return results;
  });
};
