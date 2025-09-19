// test/integration/ssr-matrix.test.ts
import { describe, it, expect } from "vitest";
import { defineComponent, h, Suspense } from "vue";
import { operations, fixtures, seedCache, mountWithClient } from "@/test/helpers";
import { delay, tick, type Route } from "@/test/helpers";
import { createCache } from "@/src/core/internals";

/** tiny helper to read rendered rows */
const rows = (wrapper: any) => wrapper.findAll("div[data-row]").map((d: any) => d.text());

/** Non-suspense reader (standard setup) */
function makeNonSuspenseApp(cachePolicy: "cache-and-network" | "cache-first" | "network-only" | "cache-only") {
  return defineComponent({
    name: "NonSuspensePosts",
    setup() {
      const { useQuery } = require("villus");
      const { data } = useQuery({
        query: operations.POSTS_QUERY,
        variables: { first: 2, after: null },
        cachePolicy,
      });
      return () =>
        (data?.value?.posts?.edges ?? []).map((e: any) =>
          h("div", { "data-row": "" }, e?.node?.title ?? ""),
        );
    },
  });
}

/** Suspense reader (await useQuery) */
function makeSuspenseApp(cachePolicy: "cache-and-network" | "cache-first" | "network-only" | "cache-only") {
  const SuspenseInner = defineComponent({
    name: "SuspenseInner",
    async setup() {
      const { useQuery } = require("villus");
      const { data } = await useQuery({
        query: operations.POSTS_QUERY,
        variables: { first: 2, after: null },
        cachePolicy,
      });
      return () =>
        (data?.value?.posts?.edges ?? []).map((e: any) =>
          h("div", { "data-row": "" }, e?.node?.title ?? ""),
        );
    },
  });

  return defineComponent({
    name: "SuspenseShell",
    setup() {
      return () =>
        h(
          Suspense,
          { timeout: 0 },
          {
            default: () => h(SuspenseInner),
            fallback: () => h("div", { "data-row": "" }, "…loading"),
          },
        );
    },
  });
}

/** common server->client setup */
async function ssrRoundTripAndMount(
  App: any,
  routes: Route[],
  seedTitles: string[]
) {
  // --- "server" side: seed into a cache and dehydrate
  const serverCache = createCache();
  await seedCache(serverCache, {
    query: operations.POSTS_QUERY,
    variables: { first: 2, after: null },
    data: {
      __typename: "Query",
      posts: fixtures.posts.connection(seedTitles, { fromId: 1 }),
    },
  });
  const snapshot = (serverCache as any).dehydrate();

  // --- "client" side: hydrate a fresh cache and mount
  const clientCache = createCache();
  (clientCache as any).hydrate(snapshot);

  const { wrapper, fx } = await mountWithClient(App, routes, clientCache);
  return { wrapper, fx };
}

/** simple route that returns a new set of posts (used to verify fetch-after-hydrate) */
function makePostsRoute(match: (v: any) => boolean, titles: string[], delayMs = 10): Route {
  return {
    when: ({ variables }) => match(variables),
    delay: delayMs,
    respond: () => ({
      data: {
        __typename: "Query",
        posts: fixtures.posts.connection(titles, { fromId: 10 }),
      },
    }),
  };
}

describe("SSR Matrix", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Suspense
  // ──────────────────────────────────────────────────────────────────────────
  describe("Suspense", () => {
    describe("cache-and-network", () => {
      it("hydrates from cache immediately, then 1 request after hydrate", async () => {
        const App = makeSuspenseApp("cache-and-network");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Fresh A", "Fresh B"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        // first frame: hydrated rows instantly
        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        // network triggers after hydrate → one call; then UI can update
        await delay(15); await tick();
        expect(fx.calls.length).toBe(1);
        expect(rows(wrapper)).toEqual(["Fresh A", "Fresh B"]);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("hydrates from cache and does NOT request after hydrate", async () => {
        const App = makeSuspenseApp("cache-first");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Should Not Be Used"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        await delay(20); await tick();
        expect(fx.calls.length).toBe(0);
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("does a request after hydrate; final render is network result", async () => {
        const App = makeSuspenseApp("network-only");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Net A", "Net B"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        // Suspense will show fallback until the awaited useQuery resolves on client
        // Hydration snapshot helps resolve quickly, but policy forces a request.
        await delay(12); await tick();
        expect(fx.calls.length).toBe(1);
        expect(rows(wrapper)).toEqual(["Net A", "Net B"]);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("hydrates from cache and never hits network", async () => {
        const App = makeSuspenseApp("cache-only");
        const routes: Route[] = [
          makePostsRoute(v => true, ["Should Not Hit"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);
        await delay(20); await tick();
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Non-suspense
  // ──────────────────────────────────────────────────────────────────────────
  describe("Non-suspense", () => {
    describe("cache-and-network", () => {
      it("hydrates from cache immediately, then 1 request after hydrate", async () => {
        const App = makeNonSuspenseApp("cache-and-network");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Fresh A", "Fresh B"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        await delay(15); await tick();
        expect(fx.calls.length).toBe(1);
        expect(rows(wrapper)).toEqual(["Fresh A", "Fresh B"]);

        await fx.restore();
      });
    });

    describe("cache-first", () => {
      it("hydrates from cache and does NOT request after hydrate", async () => {
        const App = makeNonSuspenseApp("cache-first");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Should Not Be Used"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        await delay(20); await tick();
        expect(fx.calls.length).toBe(0);
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);

        await fx.restore();
      });
    });

    describe("network-only", () => {
      it("requests after hydrate; final render is network result", async () => {
        const App = makeNonSuspenseApp("network-only");
        const routes: Route[] = [
          makePostsRoute(v => v?.first === 2 && v?.after == null, ["Net A", "Net B"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        // initial read is from cache, but policy requires a fetch
        await delay(12); await tick();
        expect(fx.calls.length).toBe(1);
        expect(rows(wrapper)).toEqual(["Net A", "Net B"]);

        await fx.restore();
      });
    });

    describe("cache-only", () => {
      it("hydrates from cache and never hits network", async () => {
        const App = makeNonSuspenseApp("cache-only");
        const routes: Route[] = [
          makePostsRoute(v => true, ["Should Not Hit"]),
        ];

        const { wrapper, fx } = await ssrRoundTripAndMount(App, routes, ["Ssr A", "Ssr B"]);

        await tick();
        expect(rows(wrapper)).toEqual(["Ssr A", "Ssr B"]);
        await delay(20); await tick();
        expect(fx.calls.length).toBe(0);

        await fx.restore();
      });
    });
  });
});
