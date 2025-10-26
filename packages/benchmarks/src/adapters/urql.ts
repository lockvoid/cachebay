import { createClient as createUrqlClient, fetchExchange } from "@urql/core";
import { cacheExchange as graphcache } from "@urql/exchange-graphcache";
import { relayPagination } from "@urql/exchange-graphcache/extras";

export type UrqlClientConfig = {
  yoga: any;
  serverUrl: string;
  cachePolicy: "network-only" | "cache-first" | "cache-and-network";
};

function mapCachePolicyToUrql(policy: "network-only" | "cache-first" | "cache-and-network"): "network-only" | "cache-first" | "cache-and-network" {
  return policy;
}

/**
 * Creates a urql Client configured for nested query benchmarks
 * Uses Yoga directly (in-memory, no HTTP)
 */
export function createUrqlClient({ yoga, serverUrl, cachePolicy }: UrqlClientConfig) {
  const cache = graphcache({
    resolvers: {
      Query: { users: relayPagination() },
      User: { posts: relayPagination(), followers: relayPagination() },
      Post: { comments: relayPagination() },
    },
  });

  // Custom fetch using Yoga directly (in-memory, no HTTP)
  const customFetch = async (url: string, options: any) => {
    return await yoga.fetch(url, options);
  };

  const client = createUrqlClient({
    url: serverUrl,
    requestPolicy: mapCachePolicyToUrql(cachePolicy),
    exchanges: [cache, fetchExchange],
    fetch: customFetch,
  });

  return client;
}
