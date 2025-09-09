import { useQuery } from "villus";

const LEGO_COLORS_QUERY = /* GraphQL */ `
  query LegoColors($after: String, $first: Int, $where: colorsBoolExp) {
    legoColors: colorsConnection(after: $after, first: $first, where: $where, orderBy: { id: ASC }) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
        cursor
        node {
          id
          name
          rgb
        }
      }
    }
  }
`

export const useLegoColorsQuery = async () => {
  const activity = useLegoColorsActivity();

  const pagination = useLegoColorsPagination();

  const variables = useLegoColorsQueryVariables();

  const query = await useQuery({ query: LEGO_COLORS_QUERY, variables });

  watch(pagination.filters, () => {
    activity.isFetching = true;
  });

  watch(query.isFetching, (isFetching) => {
    activity.isFetching = false;
  });

  const loadMore = () => {
    if (!query.data.value?.assets.pageInfo.hasNextPage || query.isFetching.value) {
      return;
    }

    pagination.setAfter(query.data.value.assets.pageInfo.endCursor);
  };

  return { ...query, loadMore };
};
