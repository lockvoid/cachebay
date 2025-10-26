import { DefaultApolloClient, useLazyQuery } from "@vue/apollo-composable";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, watch } from "vue";
import { createUserProfileYoga } from "../server/user-profile-server";
import { makeUserProfileDataset } from "../utils/seed-user-profile";
import { createApolloClient } from "../adapters";

try {
  const { loadErrorMessages, loadDevMessages } = require("@apollo/client/dev");
  loadDevMessages?.();
  loadErrorMessages?.();
} catch { /* ignore */ }

const USER_QUERY = gql`
  query GetUser($id: ID!) {
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
`;

export type VueApolloUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  loadUser(userId: string): Promise<void>;
};

export function createVueApolloUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  delayMs = 0,
  sharedYoga?: any,
): VueApolloUserProfileController {
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);

  const apolloClient = createApolloClient({ yoga, cachePolicy });

  let app: any = null;
  let componentInstance: any = null;

  const Component = defineComponent({
    setup() {
      console.log('[Apollo] setup() called');
      
      const { load, result, loading, error } = useLazyQuery(USER_QUERY, { id: "u1" });

      console.log('[Apollo] after useLazyQuery, loading:', loading.value);

      const loadUser = async (userId: string) => {
        console.log('[Apollo] loadUser called with:', userId);
        await load(USER_QUERY, { id: userId });
        console.log('[Apollo] after load, result:', result.value?.user?.email || 'NO DATA', 'loading:', loading.value);
        if (result.value?.user) {
          console.log('[Apollo]', userId, '→', result.value.user.email);
        }
      };

      watch(result, () => {
        console.log('[Apollo] result watch fired:', result.value?.user?.email || 'NO DATA');
      });

      watch(error, () => {
        if (error.value) {
          console.log('[Apollo] ERROR:', error.value);
        }
      });

      return {
        result,
        loading,
        error,
        loadUser,
      };
    },
    template: `
      <div>
        <div v-if="error" class="error">{{ error.message }}</div>
        <div v-if="result?.user" class="user">
          <div class="user-name">{{ result.user.name }}</div>
          <div class="user-email">{{ result.user.email }}</div>
          <div class="user-username">{{ result.user.username }}</div>
          <div class="user-phone">{{ result.user.phone }}</div>
          <div class="user-website">{{ result.user.website }}</div>
          <div class="user-company">{{ result.user.company }}</div>
          <div class="user-bio">{{ result.user.bio }}</div>
          <div class="user-avatar">{{ result.user.avatar }}</div>
          <div class="user-created">{{ result.user.createdAt }}</div>
          <div v-if="result.user.profile" class="profile">
            <div class="profile-bio">{{ result.user.profile.bio }}</div>
            <div class="profile-location">{{ result.user.profile.location }}</div>
            <div class="profile-website">{{ result.user.profile.website }}</div>
            <div class="profile-twitter">{{ result.user.profile.twitter }}</div>
            <div class="profile-github">{{ result.user.profile.github }}</div>
            <div class="profile-linkedin">{{ result.user.profile.linkedin }}</div>
            <div class="profile-followers">{{ result.user.profile.followers }}</div>
            <div class="profile-following">{{ result.user.profile.following }}</div>
          </div>
        </div>
      </div>
    `,
  });

  return {
    mount: (target?: Element) => {
      app = createApp(Component);
      app.provide(DefaultApolloClient, apolloClient);

      const container = target || document.createElement("div");
      componentInstance = app.mount(container);
    },

    unmount: () => {
      if (app) {
        app.unmount();
        app = null;
        componentInstance = null;
      }
    },

    loadUser: async (userId: string) => {
      if (!componentInstance) {
        throw new Error("App not mounted");
      }

      await componentInstance.loadUser(userId);
      await nextTick();
    },
  };
}
