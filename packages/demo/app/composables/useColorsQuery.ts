import { useQuery } from "villus";

export const COLOR_FIELDS = `
  fragment ColorFields on Color {
    id
    name
    rgb
  }
`;

export const COLORS_QUERY = `
  query Colors($after: String, $first: Int, $where: colorsBoolExp) {
    colors: colorsConnection(after: $after, first: $first, where: $where, orderBy: { id: ASC }) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
        cursor

        node {
          ...ColorFields
        }
      }
    }
  }
`

export const useColorsQuery = async () => {
  const activity = useColorsActivity();

  const pagination = useColorsPagination();

  const variables = useColorsQueryVariables();

  const query = await useQuery({ query: COLORS_QUERY, variables });

  watch(pagination.filters, () => {
    activity.isFetching = true;
  });

  watch(query.isFetching, (isFetching) => {
    activity.isFetching = false;
  });

  const loadMore = () => {
    if (!query.data.value?.colors.pageInfo.hasNextPage || query.isFetching.value) {
      return;
    }

    pagination.setAfter(query.data.value.colors.pageInfo.endCursor);
  };

  return { ...query, loadMore };
};
