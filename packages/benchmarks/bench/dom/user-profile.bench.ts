import { bench, describe } from "vitest";
import { createReactRelayUserProfileApp } from "../../src/ui/react-relay-user-profile-app";
import { createVueApolloUserProfileApp } from "../../src/ui/vue-apollo-user-profile-app";
import { createVueCachebayUserProfileApp } from "../../src/ui/vue-cachebay-user-profile-app";
import { createVueUrqlUserProfileApp } from "../../src/ui/vue-urql-user-profile-app";
import { generateUserProfileDataset } from "../../src/utils/seed-user-profile";

const BENCH_OPTIONS = {
  iterations: 20,
  warmupIterations: 50,
  throws: true,
  warmupTime: 0,
  time: 0,
};

describe("DOM User Profile (happy-dom): single entity with nested data", () => {
  const dataset = generateUserProfileDataset({ userCount: 1000 });
  const testUserId = "u1";

  describe("network-only", () => {
    bench("Cachebay (vue, network-only)", async () => {
      const app = createVueCachebayUserProfileApp("network-only", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Apollo (vue, network-only)", async () => {
      const app = createVueApolloUserProfileApp("network-only", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Urql (vue, network-only)", async () => {
      const app = createVueUrqlUserProfileApp("network-only", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Relay (react, network-only)", async () => {
      const app = createReactRelayUserProfileApp("network-only", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);
  });

  describe("cache-first", () => {
    bench("Cachebay (vue, cache-first)", async () => {
      const app = createVueCachebayUserProfileApp("cache-first", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Apollo (vue, cache-first)", async () => {
      const app = createVueApolloUserProfileApp("cache-first", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Urql (vue, cache-first)", async () => {
      const app = createVueUrqlUserProfileApp("cache-first", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Relay (react, cache-first)", async () => {
      const app = createReactRelayUserProfileApp("cache-first", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);
  });

  describe("cache-and-network", () => {
    bench("Cachebay (vue, cache-and-network)", async () => {
      const app = createVueCachebayUserProfileApp("cache-and-network", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Apollo (vue, cache-and-network)", async () => {
      const app = createVueApolloUserProfileApp("cache-and-network", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Urql (vue, cache-and-network)", async () => {
      const app = createVueUrqlUserProfileApp("cache-and-network", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);

    bench("Relay (react, cache-and-network)", async () => {
      const app = createReactRelayUserProfileApp("cache-and-network", 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, BENCH_OPTIONS);
  });
});
