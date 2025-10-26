import React, { useEffect, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Environment, Network, RecordSource, Store } from 'relay-runtime';
import {
  RelayEnvironmentProvider,
  graphql,
  useLazyLoadQuery,
} from 'react-relay';
import { createUserProfileYoga } from '../server/user-profile-server';
import { makeUserProfileDataset } from '../utils/seed-user-profile';

export type ReactRelayUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  loadUser(userId: string): Promise<void>;
};

type RelayFetchPolicy = "network-only" | "store-or-network" | "store-and-network";

function mapCachePolicyToRelay(policy: "network-only" | "cache-first" | "cache-and-network"): RelayFetchPolicy {
  if (policy === "cache-first") return "store-or-network";
  if (policy === "cache-and-network") return "store-and-network";
  return "network-only";
}

export function createReactRelayUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  delayMs = 0,
  sharedYoga?: any,
): ReactRelayUserProfileController {
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);
  console.log('[Relay] yoga:', typeof yoga, yoga ? 'defined' : 'undefined');

  const environment = new Environment({
    network: Network.create(async (params, variables) => {
      console.log('[Relay] network fetch, variables:', variables);
      const response = await yoga.fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: params.text,
          variables,
        }),
      });
      const json = await response.json();
      console.log('[Relay] response:', json.data?.user?.email || 'NO DATA');
      return json;
    }),
    store: new Store(new RecordSource()),
  });

  let root: Root | null = null;

  const UserProfile: React.FC<{ userId: string }> = ({ userId }) => {
    console.log('[Relay] UserProfile render, userId:', userId);

    const data = useLazyLoadQuery(
      graphql`
        query reactRelayUserProfileAppUserQuery($id: ID!) {
          user(id: $id) {
            id
            name
            email
            username
            phone
            website
            company
            bio
            avatar
            createdAt
            profile {
              id
              bio
              avatar
              location
              website
              twitter
              github
              linkedin
              followers
              following
            }
          }
        }
      `,
      { id: userId },
      { fetchPolicy: mapCachePolicyToRelay(cachePolicy) }
    );

    if (!data?.user) return <div>No user</div>;

    console.log('[Relay]', userId, '→', data.user.email);

    return (
      <div>
        <div className="user">
          <div className="user-name">{data.user.name}</div>
          <div className="user-email">{data.user.email}</div>
          <div className="user-username">{data.user.username}</div>
          <div className="user-phone">{data.user.phone}</div>
          <div className="user-website">{data.user.website}</div>
          <div className="user-company">{data.user.company}</div>
          <div className="user-bio">{data.user.bio}</div>
          <div className="user-avatar">{data.user.avatar}</div>
          <div className="user-created">{data.user.createdAt}</div>
          {data.user.profile && (
            <div className="profile">
              <div className="profile-bio">{data.user.profile.bio}</div>
              <div className="profile-location">{data.user.profile.location}</div>
              <div className="profile-website">{data.user.profile.website}</div>
              <div className="profile-twitter">{data.user.profile.twitter}</div>
              <div className="profile-github">{data.user.profile.github}</div>
              <div className="profile-linkedin">{data.user.profile.linkedin}</div>
              <div className="profile-followers">{data.user.profile.followers}</div>
              <div className="profile-following">{data.user.profile.following}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  let currentUserId = "u1";

  const App: React.FC = () => (
    <RelayEnvironmentProvider environment={environment}>
      <React.Suspense fallback={<div>Loading...</div>}>
        <UserProfile userId={currentUserId} />
      </React.Suspense>
    </RelayEnvironmentProvider>
  );

  return {
    mount: (target?: Element) => {
      const container = target || document.createElement("div");
      root = createRoot(container);
      root.render(<App />);
      // Wait for initial render
      return new Promise(resolve => setTimeout(resolve, 100));
    },

    unmount: () => {
      if (root) {
        root.unmount();
        root = null;
      }
    },

    loadUser: async (userId: string) => {
      console.log('[Relay] loadUser called with:', userId);
      currentUserId = userId;
      if (root) {
        root.render(<App />);
        // Wait for render to complete
        await new Promise(resolve => setTimeout(resolve, 50));
        console.log('[Relay] after re-render');
      }
    },
  };
}
