
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useQuery, useMutation } from "@/src/adapters/vue";
import { createTestClient, seedCache, tick, fixtures, operations } from "@/test/helpers";

describe("Mutations", () => {
  it("updates entity through normalization and returns mutation data", async () => {
    const { cache, client, fx } = createTestClient({
      routes: [
        {
          when: ({ body }) => {
            return body?.includes?.("mutation UpdateUser");
          },

          respond: () => {
            return {
              data: {
                __typename: "Mutation",

                updateUser: {
                  __typename: "UpdateUserPayload",

                  user: fixtures.users.buildNode({ id: "u1", email: "u1+updated@example.com" }),
                },
              },
            };
          },

          delay: 10,
        },
      ],
    });

    const Cmp = defineComponent({
      setup() {
        const { data } = useQuery({ query: operations.USER_QUERY, variables: { id: "u1" }, cachePolicy: "cache-first" });

        const { execute } = useMutation(operations.UPDATE_USER_MUTATION);

        const run = async () => {
          return execute({
            id: "u1",

            input: {
              email: "u1+updated@example.com",
            },
          });
        };

        return { data, run };
      },

      render() {
        return h("div", {}, this.data?.user?.email || "");
      },
    });

    const wrapper = mount(Cmp, { global: { plugins: [cache, client] } });

    await seedCache(cache, {
      query: operations.USER_QUERY,

      variables: {
        id: "u1",
      },

      data: {
        __typename: "Query",
        user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
      },
    });

    await tick();
    expect(wrapper.text()).toBe("u1@example.com");

    const response = await wrapper.vm.run();

    await tick(2);
    expect(response.error).toBeFalsy();
    expect(response.data.updateUser.user.email).toBe("u1+updated@example.com");
    expect(wrapper.text()).toBe("u1+updated@example.com");

    await fx.restore();
  });
});
