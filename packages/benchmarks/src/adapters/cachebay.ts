
import { createClient, cache as cachePlugin, fetch as fetchPlugin } from 'villus';
import { gql } from 'graphql-tag';
import type { Adapter, FeedResult } from './types';
import { createCachebay } from 'cachebay';

const FEED = gql`
  query Feed($first: Int!, $after: String) {
    feed(first: $first, after: $after) @connection {
      edges { cursor node { id title } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export function createCachebayAdapter(url: string): Adapter {
  const cachebay = createCachebay({});

  console.log('Cachebay adapter created', cachebay);

  const client = createClient({
    url,

    cachePolicy: 'cache-first',

    use: [cachePlugin, fetchPlugin]
  });

  return {
    name: 'cachebay',
    async setup() {
      return {};
    },
    async fetchPage({ first, after }): Promise<FeedResult> {
      const { data, error } = await client.executeQuery({ query: FEED, variables: { first, after } });

      if (error) throw error;

      return data!.feed;
    },
    async teardown() {
      // no-op
    },
  };
}
