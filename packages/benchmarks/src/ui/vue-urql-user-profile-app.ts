import { createClient as createUrqlClient, fetchExchange } from "@urql/core";
import { cacheExchange } from "@urql/exchange-graphcache";
import urql, { useQuery } from "@urql/vue";
import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createUserProfileYoga } from "../server/user-profile-server";
import { makeUserProfileDataset } from "../utils/seed-user-profile";

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

export type VueUrqlUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  loadUser(userId: string): Promise<void>;
};

export function createVueUrqlUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  delayMs = 0,
  sharedYoga?: any,
): VueUrqlUserProfileController {
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);
  console.log('[Urql] yoga:', typeof yoga, yoga ? 'defined' : 'undefined');

  const urqlClient = createUrqlClient({
    url: "http://localhost:4000/graphql",
    exchanges: [
      cacheExchange({
        keys: {
          User: (data: any) => data.id,
          Profile: (data: any) => data.id,
        },
      }),
      fetchExchange,
    ],
    fetch: async (url, options) => {
      console.log('[Urql] fetch called');
      return await yoga.fetch(url, options);
    },
    requestPolicy: cachePolicy === "cache-first" ? "cache-first" : cachePolicy === "cache-and-network" ? "cache-and-network" : "network-only",
  });

  let app: any = null;
  let componentInstance: any = null;

  const Component = defineComponent({
    setup() {
      const { data, error } = useQuery({
        query: USER_QUERY,
        variables: { id: "u1" },
      });

      watch(data, () => {
        if (data.value?.user) {
          console.log('[Urql]', data.value.user.id, '→', data.value.user.email);
        }
      }, { immediate: true });

      watch(error, () => {
        if (error.value) {
          console.log('[Urql] ERROR:', error.value);
        }
      });

      return {
        data,
        error,
      };
    },
    template: `
      <div>
        <div v-if="error" class="error">{{ error.message }}</div>
        <div v-if="data?.user" class="user">
          <div class="user-name">{{ data.user.name }}</div>
          <div class="user-email">{{ data.user.email }}</div>
          <div class="user-username">{{ data.user.username }}</div>
          <div class="user-phone">{{ data.user.phone }}</div>
          <div class="user-website">{{ data.user.website }}</div>
          <div class="user-company">{{ data.user.company }}</div>
          <div class="user-bio">{{ data.user.bio }}</div>
          <div class="user-avatar">{{ data.user.avatar }}</div>
          <div class="user-created">{{ data.user.createdAt }}</div>
          <div v-if="data.user.profile" class="profile">
            <div class="profile-bio">{{ data.user.profile.bio }}</div>
            <div class="profile-location">{{ data.user.profile.location }}</div>
            <div class="profile-website">{{ data.user.profile.website }}</div>
            <div class="profile-twitter">{{ data.user.profile.twitter }}</div>
            <div class="profile-github">{{ data.user.profile.github }}</div>
            <div class="profile-linkedin">{{ data.user.profile.linkedin }}</div>
            <div class="profile-followers">{{ data.user.profile.followers }}</div>
            <div class="profile-following">{{ data.user.profile.following }}</div>
          </div>
        </div>
      </div>
    `,
  });

  return {
    mount: (target?: Element) => {
      app = createApp(Component);
      app.use(urql, urqlClient);

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
