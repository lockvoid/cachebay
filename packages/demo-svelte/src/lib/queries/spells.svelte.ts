import { createQuery } from "cachebay/svelte";
import { getSettings } from "$lib/stores/settings.svelte";
import { getSpellsPagination, getSpellsActivity } from "$lib/stores/spells.svelte";
import { SPELL_FIELDS } from "./spell";

export const PAGE_INFO_FIELDS = `
  fragment PageInfoFields on PageInfo {
    startCursor
    endCursor
    hasNextPage
    hasPreviousPage
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
`;

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
`;

export const useSpellsQuery = () => {
  const settings = getSettings();
  const pagination = getSpellsPagination();
  const activity = getSpellsActivity();

  const query = createQuery({
    query: settings.relayMode === "infinite" ? SPELLS_QUERY_INFINITE_MODE : SPELLS_QUERY_PAGE_MODE,

    variables: () => {
      const results: any = {};

      if (pagination.before) {
        Object.assign(results, { before: pagination.before, last: pagination.limit });
      } else {
        Object.assign(results, { after: pagination.after, first: pagination.limit });
      }

      if (pagination.filter.query) {
        if (!results.filter) results.filter = {};
        results.filter.query = pagination.filter.query;
      }

      if (pagination.filter.sort) {
        if (!results.filter) results.filter = {};
        results.filter.sort = pagination.filter.sort;
      }

      return results;
    },
  });

  $effect(() => {
    if (!query.isFetching) {
      activity.isFetching = false;
    }
  });

  const loadMore = () => {
    if (!query.data?.spells.pageInfo.hasNextPage || query.isFetching) {
      return;
    }

    pagination.setAfter(query.data.spells.pageInfo.endCursor);
  };

  const loadPreviousPage = () => {
    if (!query.data?.spells.pageInfo.hasPreviousPage) {
      return;
    }

    pagination.setBefore(query.data.spells.pageInfo.startCursor);
  };

  const loadNextPage = () => {
    if (!query.data?.spells.pageInfo.hasNextPage) {
      return;
    }

    pagination.setAfter(query.data.spells.pageInfo.endCursor);
  };

  return {
    get data() { return query.data; },
    get error() { return query.error; },
    get isFetching() { return query.isFetching; },
    refetch: query.refetch,
    loadMore,
    loadPreviousPage,
    loadNextPage,
  };
};
