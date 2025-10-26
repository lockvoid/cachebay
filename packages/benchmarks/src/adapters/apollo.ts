import { ApolloClient, InMemoryCache, ApolloLink, Observable } from "@apollo/client/core";
import { relayStylePagination } from "@apollo/client/utilities";

export type ApolloClientConfig = {
  yoga: any;
  cachePolicy: "network-only" | "cache-first" | "cache-and-network";
};

/**
 * Creates an Apollo Client configured for nested query benchmarks
 * Uses Yoga directly (in-memory, no HTTP)
 */
export function createApolloClient({ yoga, cachePolicy }: ApolloClientConfig) {
  // Custom Apollo Link using Yoga directly (in-memory, no HTTP)
  const yogaLink = new ApolloLink((operation) => {
    return new Observable((observer) => {
      (async () => {
        try {
          // Use print from graphql to convert the query AST to string
          const { print } = await import('graphql');
          const query = print(operation.query);

          const response = await yoga.fetch('http://localhost/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              variables: operation.variables,
              operationName: operation.operationName,
            }),
          });

          const result = await response.json();
          observer.next(result);
          observer.complete();
        } catch (error) {
          observer.error(error);
        }
      })();
    });
  });

  const client = new ApolloClient({
    cache: new InMemoryCache({
      typePolicies: {
        Query: {
          fields: {
            users: relayStylePagination(["first"]),
          },
        },
        User: {
          fields: {
            posts: relayStylePagination(["first"]),
            followers: relayStylePagination(["first"]),
          },
        },
        Post: {
          fields: {
            comments: relayStylePagination(["first"]),
          },
        },
      },
    }),
    link: yogaLink,
    defaultOptions: { query: { fetchPolicy: cachePolicy } },
  });

  // Keep client behavior unchanged - strip canonizeResults
  const stripCanon = (o?: Record<string, unknown>) => {
    if (!o) return;
    if ("canonizeResults" in o) {
      try { delete (o as any).canonizeResults; }
      catch { (o as any).canonizeResults = undefined; }
    }
  };
  
  const _query = client.query.bind(client);
  client.query = (opts: any) => {
    stripCanon(opts);
    return _query(opts);
  };

  return client;
}
