// test/integration/mutations-simulated.test.ts
import { describe, it, expect } from "vitest";
import { defineComponent, h, watch } from "vue";
import gql from "graphql-tag";

import { mountWithClient } from "@/test/helpers/integration";
import { seedCache, tick, type Route } from "@/test/helpers";
import { operations } from "@/test/helpers";

const UPDATE_USER_MUTATION = gql/* GraphQL */ `
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      __typename
      user { __typename id email name }
    }
  }
`;

describe("Mutations", () => {
  it("entity updates via normalization after mutation", async () => {
    const App = defineComponent({
      name: "UserViewerAndMutator",
      setup() {
        const { useQuery, useMutation } = require("villus");

        const { data } = useQuery({
          query: operations.USER_QUERY,
          variables: { id: "u1" },
          cachePolicy: "cache-first",
        });

        const { execute } = useMutation(UPDATE_USER_MUTATION);
        const run = async () => {
          const res = await execute({
            id: "u1",
            input: { email: "u1+updated@example.com", name: "Updated Name" },
          });
        };

        return { data, run };
      },
      render() {
        const txt = this.data?.user?.email || "";

        return h("div", {}, txt);
      },
    });

    const routes: Route[] = [
      {
        when: ({ body }) =>
          typeof body === "string" && body.includes("mutation UpdateUser"),
        delay: 10,
        respond: () => {
          return {
            data: {
              __typename: "Mutation",
              updateUser: {
                __typename: "UpdateUserPayload",
                user: {
                  __typename: "User",
                  id: "u1",
                  email: "u1+updated@example.com",
                  name: "Updated Name",
                },
              },
            },
          };
        },
      },
    ];

    const { wrapper, cache, fx } = await mountWithClient(App, routes);

    // seed initial query snapshot so cache-first renders a value
    await seedCache(cache, {
      query: operations.USER_QUERY,
      variables: { id: "u1" },
      data: {
        __typename: "Query",
        user: { __typename: "User", id: "u1", email: "u1@example.com" },
      },
    });
    await tick();

    expect(wrapper.text()).toBe("u1@example.com");

    // trigger the mutation (no optimistic)
    await (wrapper.vm as any).run();

    // Wait for the mock transport to complete (no guessing with fixed delay)
    await fx.waitAll?.();

    // One (or two) ticks to let the cache view re-materialize if needed
    await tick(2);

    // Debug: peek the entity snapshot (OK to log internals while debugging)
    const snap = (cache as any).__internals?.graph?.getRecord("User:u1");

    expect(wrapper.text()).toBe("u1+updated@example.com");

    await fx.restore?.();
  });
});
