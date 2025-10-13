import { createYoga, createSchema } from 'graphql-yoga';
import { createServer as createHttpServer } from 'node:http';
import { Buffer } from 'node:buffer';
import type { Post } from '../utils/seed';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function encodeCursor(index: number): string {
  return Buffer.from(`cursor:${index}`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return -1;
  try {
    const s = Buffer.from(cursor, 'base64').toString('utf8');
    const m = s.match(/^cursor:(\d+)$/);
    return m ? parseInt(m[1], 10) : -1;
  } catch {
    return -1;
  }
}

export type ServerCtrl = {
  url: string;
  stop: () => Promise<void>;
};

export async function startServer(
  dataset: Post[],
  opts?: { artificialDelayMs?: number }
): Promise<ServerCtrl> {
  const artificialDelayMs = opts?.artificialDelayMs ?? 20;

  const yoga = createYoga({
    graphqlEndpoint: '/graphql',
    cors: true,
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

        type PageInfo {
          startCursor: String
          endCursor: String
          hasPreviousPage: Boolean!
          hasNextPage: Boolean!
        }

        type Post {
          id: ID!
          title: String!
        }
      `,
      resolvers: {
        Query: {
          feed: async (_: unknown, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);

            // after=null -> decodeCursor returns -1, so start at 0
            const startIndex = decodeCursor(args.after) + 1;

            const slice = dataset.slice(startIndex, startIndex + args.first);

            const edges = slice.map((node, i) => ({
              cursor: encodeCursor(startIndex + i),
              node,
            }));

            const endIndex = startIndex + slice.length - 1;

            const startCursor = slice.length > 0 ? encodeCursor(startIndex) : null;
            const endCursor = slice.length > 0 ? encodeCursor(endIndex) : null;

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

  // ✅ Use named import to avoid "default.createServer is not a function"
  const server = createHttpServer(yoga);

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind server');

  const url = `http://127.0.0.1:${addr.port}/graphql`;

  return {
    url,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
      ),
  };
}
