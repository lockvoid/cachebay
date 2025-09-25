// test/integration/mutations-simulated.test.ts
import { describe, it, expect } from "vitest";
import { defineComponent, h } from "vue";
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

        // IMPORTANT: return the result so the test can assert it
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

    // seed initial query so cache-first renders a value
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

    // run mutation and assert the returned payload
    const res = await (wrapper.vm as any).run();
    await fx.waitAll?.();        // wait transport
    await tick(2);               // let views re-materialize

    expect(res?.error).toBeFalsy();
    expect(res?.data?.updateUser?.user?.email).toBe("u1+updated@example.com");
    expect(wrapper.text()).toBe("u1+updated@example.com");

    await fx.restore?.();
  });
});
