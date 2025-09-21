import { useQuery } from "villus";

export const PAGE_INFO_FIELDS = `
  fragment PageInfoFields on PageInfo {
    startCursor
    endCursor
    hasNextPage
    hasPreviousPage
  }
`;

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

export const SPELLS_QUERY_INFINITE_MODE = `
  ${PAGE_INFO_FIELDS}
  ${SPELL_FIELDS}

  query Spells($after: String, $before: String, $first: Int, $last: Int, $filter: SpellFilter) {
    spells(after: $after, before: $before, first: $first, last: $last, filter: $filter) @connection(mode: "infinite") {
      pageInfo {
        ...PageInfoFields
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

export const SPELLS_QUERY_PAGE_MODE = `
  ${PAGE_INFO_FIELDS}
  ${SPELL_FIELDS}

  query Spells($after: String, $before: String, $first: Int, $last: Int, $filter: SpellFilter) {
    spells(after: $after, before: $before, first: $first, last: $last, filter: $filter) @connection(mode: "page") {
      pageInfo {
        ...PageInfoFields
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
  const settings = useSettings();

  const activity = useSpellsActivity();

  const pagination = useSpellsPagination();

  const variables = useSpellsQueryVariables();

  const query = await useQuery({ query: settings.relayMode === 'infinite' ? SPELLS_QUERY_INFINITE_MODE : SPELLS_QUERY_PAGE_MODE, variables });

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

  const loadPreviousPage = () => {
    if (!query.data.value?.spells.pageInfo.hasPreviousPage) {
      return;
    }

    pagination.setBefore(query.data.value.spells.pageInfo.startCursor);
  };

  const loadNextPage = () => {
    if (!query.data.value?.spells.pageInfo.hasNextPage) {
      return;
    }

    pagination.setAfter(query.data.value.spells.pageInfo.endCursor);
  };

  return { ...query, loadMore, loadPreviousPage, loadNextPage };
};
