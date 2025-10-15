import { ApolloClient, InMemoryCache, ApolloLink, Observable } from "@apollo/client/core";
import { relayStylePagination } from "@apollo/client/utilities";
import { createYogaFetcher } from '../utils/graphql';

export type ApolloClientConfig = {
  yoga: any;
  cachePolicy: "network-only" | "cache-first" | "cache-and-network";
};

export const createApolloClient = ({ yoga, cachePolicy }: ApolloClientConfig) => {
  const fetcher = createYogaFetcher(yoga, 'http://localhost/graphql');

  const yogaLink = new ApolloLink((operation) => {
    return new Observable((observer) => {
      (async () => {
        try {
          const { print } = await import('graphql');
          const query = print(operation.query);
          const result = await fetcher(query, operation.variables);

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

  const stripCanon = (o?: Record<string, unknown>) => {
    if (!o) {
      return;
    }

    if ("canonizeResults" in o) {
      try {
        delete (o as any).canonizeResults;
      } catch {
        (o as any).canonizeResults = undefined;
      }
    }
  };

  const _query = client.query.bind(client);
  client.query = (options: any) => {
    stripCanon(options);
    return _query(options);
  };

  return client;
};
