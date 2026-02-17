import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  createTestMutation,
  seedCache,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

describe("Mutations (Svelte)", () => {
  it("updates entity through normalization and returns mutation data", async () => {
    const routes = [
      {
        when: ({ body }: any) => body?.includes?.("mutation UpdateUser"),
        respond: () => ({
          data: {
            __typename: "Mutation",
            updateUser: {
              __typename: "UpdateUserPayload",
              user: {
                ...fixtures.users.buildNode({ id: "u1", email: "u1+updated@example.com" }),
                posts: {
                  __typename: "PostConnection",
                  pageInfo: {
                    __typename: "PageInfo",
                    startCursor: null,
                    endCursor: null,
                    hasNextPage: false,
                    hasPreviousPage: false,
                  },
                  edges: [],
                },
              },
            },
          },
        }),
        delay: 15,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    await seedCache(cache, {
      query: operations.USER_QUERY,
      variables: { id: "u1" },
      data: {
        __typename: "Query",
        user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
      },
    });

    // Create a query watching the user
    const q = createTestQuery(cache, operations.USER_QUERY, {
      variables: () => ({ id: "u1" }),
      cachePolicy: "cache-first",
    });

    await tick();
    flushSync();
    await delay(5);
    flushSync();

    expect(q.data?.user?.email).toBe("u1@example.com");

    // Execute mutation
    const m = createTestMutation(cache, operations.UPDATE_USER_MUTATION);

    const response = await m.execute({
      id: "u1",
      input: { email: "u1+updated@example.com" },
      postCategory: "tech",
      postFirst: 10,
      postAfter: null,
    });

    await delay(20);
    await tick();
    flushSync();

    expect(response.error).toBeFalsy();
    expect(response.data.updateUser.user.email).toBe("u1+updated@example.com");

    // Query should reflect the normalized update
    expect(q.data?.user?.email).toBe("u1+updated@example.com");

    q.dispose();
    m.dispose();
    await fx.restore();
  });

  it("handles mutation response with null fields correctly", async () => {
    const CREATE_UPLOAD_MUTATION = `
      mutation CreateDirectUpload($input: CreateDirectUploadInput!) {
        createDirectUpload(input: $input) {
          directUpload {
            uploadUrl
            __typename
          }
          errors {
            message
            __typename
          }
          __typename
        }
      }
    `;

    const routes = [
      {
        when: ({ body }: any) => body?.includes?.("mutation CreateDirectUpload"),
        respond: () => ({
          data: {
            createDirectUpload: {
              directUpload: {
                uploadUrl: "https://example.com/upload",
                __typename: "DirectUpload",
              },
              errors: null,
              __typename: "CreateDirectUploadPayload",
            },
          },
        }),
        delay: 10,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const m = createTestMutation(cache, CREATE_UPLOAD_MUTATION);

    const response = await m.execute({
      input: {
        filename: "test.wav",
        contentType: "audio/wav",
        byteSize: 1024,
      },
    });

    await delay(15);

    expect(response.error).toBeFalsy();
    expect(response.data.createDirectUpload.directUpload.uploadUrl).toBe("https://example.com/upload");
    expect(response.data.createDirectUpload.errors).toBeNull();

    m.dispose();
    await fx.restore();
  });
});
