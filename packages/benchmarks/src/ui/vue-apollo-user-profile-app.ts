import { DefaultApolloClient, useQuery } from "@vue/apollo-composable";
import { createApp, defineComponent, watch } from "vue";
import { createUserProfileYoga } from "../server/user-profile-server";
import { makeUserProfileDataset } from "../utils/seed-user-profile";
import { createApolloClient } from "../adapters";
import { createDeferred } from "../utils/concurrency";
import { USER_PROFILE_QUERY } from "../utils/queries";

export const createVueApolloUserProfileApp = (
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "network-only",
  delayMs = 0,
  sharedYoga?: any,
) => {
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);

  const apolloClient = createApolloClient({ yoga, cachePolicy });

  let app: any = null;
  let componentInstance: any = null;

  const deferred = createDeferred();

  const Component = defineComponent({
    setup() {
      const { result, loading, error } = useQuery(USER_PROFILE_QUERY, { id: "u1" });

      watch(result, () => {
        if (result.value?.user) {
        }
      }, { immediate: true });

      watch(loading, () => {
        if (!loading.value) {
          deferred.resolve();
        }
      });

      watch(error, () => {
        if (error.value) {
        }
      });

      return {
        result,
        loading,
        error,
      };
    },
    template: `
      <div>
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

    ready: async () => {
      await deferred.promise;
    },
  };
}
