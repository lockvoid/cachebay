
import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client/core';
import { relayStylePagination } from '@apollo/client/utilities';
import type { Adapter, FeedResult } from './types';

const FEED = gql`
  query Feed($first: Int!, $after: String) {
    feed(first: $first, after: $after) {
      edges { cursor node { id title } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export function createApolloAdapter(url: string): Adapter {
  const client = new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            feed: relayStylePagination(),
          },
        },
      },
    }),
    link: new HttpLink({ uri: url, fetch }),
    defaultOptions: { query: { fetchPolicy: 'network-only' } },
  });

  return {
    name: 'apollo',
    async setup() {
      return {};
    },
    async fetchPage({ first, after }): Promise<FeedResult> {
      const { data } = await client.query({ query: FEED, variables: { first, after } });
      return data.feed;
    },
    async teardown() {
      client.stop();
    },
  };
}
