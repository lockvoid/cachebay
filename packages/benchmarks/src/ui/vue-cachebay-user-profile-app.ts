import { createApp, defineComponent, watch } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";
import { createDeferred } from "../utils/concurrency";
import { USER_PROFILE_QUERY } from "../utils/queries";

export const createVueCachebayUserProfileApp = (
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "cache-first",
  sharedYoga: any
) => {
  const yoga = sharedYoga;

  const deferred = createDeferred();

  const transport = {
    http: async (context: any) => {
      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });

      const result = await response.json();

      return { data: result.data, error: result.errors?.[0] };
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
        query: USER_PROFILE_QUERY,
        variables: { id: 'u1' },
        cachePolicy,
        lazy: false,
      });

      watch(data, () => {
        if (data.value?.user) {
          deferred.resolve();
        }
      }, { immediate: true });

      return {
        data,
        error,
      };
    },
    template: `
      <div>
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
      await deferred.promise;
    },
  };
}
