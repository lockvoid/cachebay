import { createYoga, createSchema } from 'graphql-yoga';
import { createServer as createHttpServer } from 'http';
import type { Post } from '../utils/seed';
import { delay, encodeCursor, decodeCursor } from '../utils/graphql';

export type ServerCtrl = {
  url: string;
  stop: () => Promise<void>;
};

export const startServer = async (
  dataset: Post[],
  opts: { artificialDelayMs?: number; port?: number } = {}
): Promise<ServerCtrl> => {
  const port = opts.port || 4000;

  const yoga = createYoga({
    schema: createSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          feed(first: Int!, after: String): FeedConnection!
        }
        type FeedConnection {
          edges: [FeedEdge!]!
          pageInfo: PageInfo!
        }
        type FeedEdge {
          cursor: String!
          node: Post!
        }
        type Post {
          id: ID!
          title: String!
        }
        type PageInfo {
          startCursor: String
          endCursor: String
          hasPreviousPage: Boolean!
          hasNextPage: Boolean!
        }
      `,
      resolvers: {
        Query: {
          feed: async (_parent, { first, after }) => {
            if (options.artificialDelayMs) await delay(options.artificialDelayMs);

            const startIndex = after ? decodeCursor(after) + 1 : 0;
            const endIndex = Math.min(startIndex + first - 1, dataset.length - 1);

            const edges = [];
            for (let i = startIndex; i <= endIndex; i++) {
              edges.push({
                cursor: encodeCursor(i),
                node: dataset[i],
              });
            }

            const startCursor = edges.length > 0 ? edges[0].cursor : null;
            const endCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
            const hasPreviousPage = startIndex > 0;
            const hasNextPage = endIndex < dataset.length - 1;

            return {
              edges,
              pageInfo: { startCursor, endCursor, hasPreviousPage, hasNextPage },
            };
          },
        },
      },
    }),
  });

  const server = createHttpServer(yoga);

  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${port}/graphql`;

  return {
    url,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve())),
      ),
  };
};
