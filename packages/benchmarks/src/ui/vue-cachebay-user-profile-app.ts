import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";
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

export type VueCachebayUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  loadUser(userId: string): Promise<void>;
};

export function createVueCachebayUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "cache-first",
  delayMs = 0,
  sharedYoga?: any, // Optional shared Yoga instance
): VueCachebayUserProfileController {
  // Use shared Yoga instance if provided, otherwise create new one
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);
  console.log('[Cachebay] yoga:', typeof yoga, yoga ? 'defined' : 'undefined', typeof yoga.fetch);

  // Transport calls Yoga's fetch directly - no HTTP, no network, no serialization
  const transport = {
    http: async (operation: any) => {
      try {
        console.log('[Cachebay] transport.http called, operation:', operation.operationName || 'unnamed', 'variables:', operation.variables);
        console.log('[Cachebay] about to call yoga.fetch...');
        const response = await yoga.fetch("http://localhost:4000/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(operation),
        });
        console.log('[Cachebay] got response, status:', response.status);
        const json = await response.json();
        console.log('[Cachebay] transport response:', json.data?.user?.email || json.errors || 'NO DATA');
        return json;
      } catch (error) {
        console.log('[Cachebay] transport ERROR:', error);
        throw error;
      }
    },
  };

  let appInstance: any = null;
  let mounted = false;

  let componentInstance: any = null;

  let userId = ref({ id: 'u1' });

  const Component = defineComponent({
    setup() {
      console.log('[Cachebay] setup() called, userId:', userId.value);
      
      const { data, error, isFetching } = useQuery({
        query: USER_QUERY,
        variables: userId,
        cachePolicy,
      });

      console.log('[Cachebay] after useQuery, isFetching:', isFetching.value);

      watch(data, () => {
        console.log('[Cachebay] watch fired, data:', data.value?.user?.email || 'NO DATA', 'isFetching:', isFetching.value);
        if (data.value?.user) {
          console.log('[Cachebay]', userId.value.id, '→', data.value.user.email);
        }
      }, { immediate: true });

      watch(error, () => {
        if (error.value) {
          console.log('[Cachebay] ERROR:', error.value);
        }
      });

      return {
        data,
        error,
        isFetching,
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
      if (mounted) return;

      const client = createCachebay({
        url: "http://localhost:4000/graphql",
        transport,
      });

      appInstance = createApp(Component);
      appInstance.use(client);

      const container = target || document.createElement("div");
      componentInstance = appInstance.mount(container);
      mounted = true;
    },

    unmount: () => {
      if (!mounted || !appInstance) return;
      appInstance.unmount();
      appInstance = null;
      componentInstance = null;
      mounted = false;
    },

    loadUser: async (id: string) => {
      if (!mounted) {
        throw new Error("App not mounted");
      }

      userId.value = { id };
      await nextTick();
      await nextTick(); // Extra tick to ensure query completes
    },
  };
}
