import { createYoga, createSchema } from 'graphql-yoga';
import { createServer as createHttpServer } from 'http';
import type { NestedDataset } from '../utils/seed-nested';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Browser-compatible base64 encoding
function encodeCursor(index: number): string {
  return btoa(`cursor:${index}`);
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return -1;
  try {
    const s = atob(cursor);
    const m = s.match(/^cursor:(\d+)$/);
    return m ? parseInt(m[1], 10) : -1;
  } catch {
    return -1;
  }
}

function paginateArray<T>(arr: T[], first: number, after?: string) {
  const startIndex = decodeCursor(after) + 1;
  const slice = arr.slice(startIndex, startIndex + first);
  
  const edges = slice.map((node, i) => ({
    cursor: encodeCursor(startIndex + i),
    node,
  }));
  
  const endIndex = startIndex + slice.length - 1;
  const startCursor = slice.length > 0 ? encodeCursor(startIndex) : null;
  const endCursor = slice.length > 0 ? encodeCursor(endIndex) : null;
  const hasPreviousPage = startIndex > 0;
  const hasNextPage = endIndex < arr.length - 1;
  
  return {
    edges,
    pageInfo: { startCursor, endCursor, hasPreviousPage, hasNextPage },
  };
}

export type ServerCtrl = {
  url: string;
  stop: () => Promise<void>;
};

export function createNestedYoga(dataset: NestedDataset, artificialDelayMs = 0) {
  const schema = createSchema({
      typeDefs: /* GraphQL */ `
        interface Node {
          id: ID!
        }

        type Query {
          feed(first: Int!, after: String): FeedConnection!
          users(first: Int!, after: String): UserConnection!
        }

        type FeedConnection {
          edges: [FeedEdge!]!
          pageInfo: PageInfo!
        }

        type FeedEdge {
          cursor: String!
          node: Post!
        }

        type UserConnection {
          edges: [UserEdge!]!
          pageInfo: PageInfo!
        }

        type UserEdge {
          cursor: String!
          node: User!
        }

        type PostConnection {
          edges: [PostEdge!]!
          pageInfo: PageInfo!
        }

        type PostEdge {
          cursor: String!
          node: Post!
        }

        type CommentConnection {
          edges: [CommentEdge!]!
          pageInfo: PageInfo!
        }

        type CommentEdge {
          cursor: String!
          node: Comment!
        }

        type PageInfo {
          startCursor: String
          endCursor: String
          hasPreviousPage: Boolean!
          hasNextPage: Boolean!
        }

        type User implements Node {
          id: ID!
          name: String!
          avatar: String!
          posts(first: Int!, after: String): PostConnection!
          followers(first: Int!, after: String): UserConnection!
        }

        type Post implements Node {
          id: ID!
          title: String!
          content: String!
          author: User!
          comments(first: Int!, after: String): CommentConnection!
          likeCount: Int!
        }

        type Comment implements Node {
          id: ID!
          text: String!
          author: User!
          post: Post!
        }
      `,
      resolvers: {
        Query: {
          feed: async (_: unknown, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);
            const allPosts = Array.from(dataset.posts.values());
            return paginateArray(allPosts, args.first, args.after);
          },
          users: async (_: unknown, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);
            const allUsers = Array.from(dataset.users.values());
            return paginateArray(allUsers, args.first, args.after);
          },
        },
        User: {
          posts: async (user: any, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);
            const userPosts = user.postIds.map((id: string) => dataset.posts.get(id)!);
            return paginateArray(userPosts, args.first, args.after);
          },
          followers: async (user: any, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);
            const userFollowers = user.followerIds.map((id: string) => dataset.users.get(id)!);
            return paginateArray(userFollowers, args.first, args.after);
          },
        },
        Post: {
          author: async (post: any) => {
            await delay(artificialDelayMs);
            return dataset.users.get(post.authorId)!;
          },
          comments: async (post: any, args: { first: number; after?: string }) => {
            await delay(artificialDelayMs);
            const postComments = post.commentIds.map((id: string) => dataset.comments.get(id)!);
            return paginateArray(postComments, args.first, args.after);
          },
        },
        Comment: {
          author: async (comment: any) => {
            await delay(artificialDelayMs);
            return dataset.users.get(comment.authorId)!;
          },
          post: async (comment: any) => {
            await delay(artificialDelayMs);
            return dataset.posts.get(comment.postId)!;
          },
        },
      },
    });
  
  return createYoga({
    schema,
  });
}

export async function startNestedServer(
  dataset: NestedDataset,
  opts: { artificialDelayMs?: number; port?: number } = {}
): Promise<ServerCtrl> {
  const port = opts.port || 4001;
  const artificialDelayMs = opts?.artificialDelayMs ?? 0;

  const yoga = createNestedYoga(dataset, artificialDelayMs);

  const server = createHttpServer(yoga);

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));

  const url = `http://127.0.0.1:${port}/graphql`;

  return {
    url,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close(err => (err ? reject(err) : resolve()))
      ),
  };
}
