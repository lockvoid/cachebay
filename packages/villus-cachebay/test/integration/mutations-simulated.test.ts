
import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";

import { mountWithClient } from "@/test/helpers/integration";
import { seedCache, tick, type Route } from "@/test/helpers";
import { operations, UPDATE_USER_MUTATION } from "@/test/helpers";

describe("Mutations", () => {
  it("entity updates via normalization after mutation, and execute() returns data", async () => {
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
          return execute({
            id: "u1",
            input: { email: "u1+updated@example.com", name: "Updated Name" },
          });
        };

        return { data, run };
      },
      render() {
        return h("div", {}, this.data?.user?.email || "");
      },
    });

    const routes: Route[] = [
      {
        when: ({ body }) =>
          typeof body === "string" && body.includes("mutation UpdateUser"),
        delay: 10,
        respond: () => ({
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
        }),
      },
    ];

    const { wrapper, cache, fx } = await mountWithClient(App, routes);

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

    const res = await (wrapper.vm as any).run();
    await fx.waitAll?.();
    await tick(2);

    expect(res?.error).toBeFalsy();
    expect(res?.data?.updateUser?.user?.email).toBe("u1+updated@example.com");
    expect(wrapper.text()).toBe("u1+updated@example.com");

    await fx.restore?.();
  });
});
