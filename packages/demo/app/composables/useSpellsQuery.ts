import { useQuery } from "villus";

export const SPELL_FIELDS = `
  fragment SpellFields on Spell {
    id
    name
    slug
    category
    creator
    effect
    image
    light
    wiki
  }
`;

export const SPELLS_QUERY = `
  ${SPELL_FIELDS}

  query Spells($after: String, $first: Int, $filter: SpellFilter) {
    spells: spells(after: $after, first: $first, filter: $filter) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
        cursor

        node {
          ...SpellFields
        }
      }
    }
  }
`

export const useSpellsQuery = async () => {
  const activity = useSpellsActivity();

  const pagination = useSpellsPagination();

  const variables = useSpellsQueryVariables();

  const query = await useQuery({ query: SPELLS_QUERY, variables });

  watch(pagination.filters, () => {
    activity.isFetching = true;
  });

  watch(query.isFetching, (isFetching) => {
    activity.isFetching = false;
  });

  const loadMore = () => {
    if (!query.data.value?.spells.pageInfo.hasNextPage || query.isFetching.value) {
      return;
    }

    pagination.setAfter(query.data.value.spells.pageInfo.endCursor);
  };

  return { ...query, loadMore };
};
