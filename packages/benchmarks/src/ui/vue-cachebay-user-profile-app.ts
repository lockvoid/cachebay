import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";
import { createUserProfileYoga } from "../server/user-profile-server";
import { makeUserProfileDataset } from "../utils/seed-user-profile";
import { createDeferred } from "../utils/concurrency";

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

export type VueCachebayUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  ready(): Promise<void>;
};

export function createVueCachebayUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "cache-first",
  delayMs = 0,
  sharedYoga?: any, // Optional shared Yoga instance
): VueCachebayUserProfileController {
  // Use shared Yoga instance if provided, otherwise create new one
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);

  const deferred = createDeferred();

  // Transport calls Yoga's fetch directly - no HTTP, no network, no serialization
  const transport = {
    http: async (context: any) => {
      // Use Yoga's fetch API (works in-memory without HTTP)
      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });

      const result = await response.json();
      // console.log('[Cachebay]', context.variables?.id, '→', result.data?.user?.email || 'NO DATA');

      return {
        data: result.data || null,
        error: result.errors?.[0] || null
      };
    },
  };

  const plugin = createCachebay({
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });

  let app: any = null;
  let componentInstance: any = null;

  const Component = defineComponent({
    setup() {
      const { data, error } = useQuery({
        query: USER_QUERY,
        variables: { id: 'u1' },
        cachePolicy,
        lazy: false,
      });

      watch(data, () => {
        if (data.value?.user) {
          // console.log('[Cachebay]', data.value.user.id, '→', data.value.user.email);
          deferred.resolve();
        }
      }, { immediate: true });

      watch(error, () => {
        if (error.value) {
          // console.log('[Cachebay] ERROR:', error.value);
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
      app.use(plugin);

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

    ready: async () => {
      // Wait for query to complete
      await deferred.promise;
    },
  };
}
