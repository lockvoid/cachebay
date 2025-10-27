import { createServer as createHttpServer } from "http";
import { createYoga, createSchema } from "graphql-yoga";
import { delay, paginateArray } from "../utils/graphql";
import type { NestedDataset } from "../utils/seed-infinite-feed";

export type ServerCtrl = {
  url: string;
  stop: () => Promise<void>;
};

export const createInfiniteFeedYoga = (dataset: NestedDataset, artificialDelayMs = 0) => {
  const schema = createSchema({
    typeDefs: `
      interface Node {
        id: ID!
      }

      type Query {
        users(first: Int!, after: String): UserConnection!
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
        users: async (_: unknown, args: { first: number; after?: string }) => {
          await delay(artificialDelayMs);
          const users = Array.from(dataset.users.values());
          return paginateArray(users, args.first, args.after);
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
};
