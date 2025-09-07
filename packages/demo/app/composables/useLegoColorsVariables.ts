export const useLegoColorsQueryVariables = () => {
	const pagination = useLegoColorsPagination();

	return computed(() =>	{
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
