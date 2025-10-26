import { createYoga, createSchema } from 'graphql-yoga';
import type { UserProfileDataset } from '../utils/seed-user-profile';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createUserProfileYoga(dataset: UserProfileDataset, delayMs = 0) {
  return createYoga({
    schema: createSchema({
      typeDefs: `
        type Query {
          user(id: ID!): User
        }

        type User {
          id: ID!
          name: String!
          email: String!
          username: String!
          phone: String!
          website: String!
          company: String!
          bio: String!
          avatar: String!
          createdAt: String!
          profile: Profile!
        }

        type Profile {
          id: ID!
          bio: String!
          avatar: String!
          location: String!
          website: String!
          twitter: String!
          github: String!
          linkedin: String!
          followers: Int!
          following: Int!
        }
      `,
      resolvers: {
        Query: {
          user: async (_: any, { id }: { id: string }) => {
            if (delayMs > 0) await delay(delayMs);
            return dataset.users.get(id) || null;
          },
        },
        User: {
          profile: (user: any) => {
            return dataset.profiles.get(user.profile.id);
          },
        },
      },
    }),
  });
}
