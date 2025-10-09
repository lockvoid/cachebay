import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import { operations } from "@/test/helpers";
import { users, posts, comments, tags, medias } from "@/test/helpers/fixtures";

describe("documents.normalizeDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let optimistic: ReturnType<typeof createOptimistic>;
  let planner: ReturnType<typeof createPlanner>;
  let views: ReturnType<typeof createViews>;
  let canonical: ReturnType<typeof createCanonical>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({
      keys: {
        Profile: (profile) => profile.slug,
        Media: (media) => media.key,
        Stat: (stat) => stat.key,
        Comment: (comment) => comment.uuid,
      },
      interfaces: {
        Post: ["AudioPost", "VideoPost"],
      },
    });

    optimistic = createOptimistic({ graph });
    views = createViews({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, views, canonical, planner });
  });

  it.only("normalizes root reference and entity snapshot for single user query", () => {
    documents.normalizeDocument({
      document: operations.USER_QUERY,
      variables: {
        id: "u1",
      },
      data: {
        user: users.buildNode({
          id: "u1",
          email: "u1@example.com",
        }),
      },
    });

    expect(graph.getRecord("@")).toEqual({
      id: "@",
      __typename: "@",
      'user({"id":"u1"})': {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1@example.com",
    });
  });

  it.only("normalizes root users connection with edge records", () => {
    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "admin",
        first: 2,
        after: null,
      },
      data: {
        users: users.buildConnection(
          [
            {
              id: "u1",
              email: "u1@example.com",
            },
            {
              id: "u2",
              email: "u2@example.com",
            },
          ],
          {
            hasNextPage: true,
          },
        ),
      },
    });

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "admin",
        first: 2,
        after: "u2",
      },
      data: {
        users: users.buildConnection(
          [
            {
              id: "u3",
              email: "u3@example.com",
            },
          ],
          {
            startCursor: "u3",
            endCursor: "u3",
          },
        ),
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"after":null,"first":2,"role":"admin"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"after":null,"first":2,"role":"admin"}).edges:0',
          '@.users({"after":null,"first":2,"role":"admin"}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges:1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord('@.users({"after":"u2","first":2,"role":"admin"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"after":"u2","first":2,"role":"admin"}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"after":"u2","first":2,"role":"admin"}).edges:0'],
      },
    });

    expect(graph.getRecord('@.users({"after":"u2","first":2,"role":"admin"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "u3",
      node: {
        __ref: "User:u3",
      },
    });
  });

  it.only("preserves both category connections when writing tech then lifestyle posts", () => {
    const userPostsTech = {
      user: {
        ...users.buildNode({
          id: "u1",
          email: "u1@example.com",
        }),
        posts: {
          ...posts.buildConnection(
            [
              {
                id: "p1",
                title: "Post 1",
                flags: ["react"],
                author: {
                  __typename: "User",
                  id: "u1",
                },
              },
              {
                id: "p2",
                title: "Post 2",
                flags: ["js"],
                author: {
                  __typename: "User",
                  id: "u1",
                },
              },
            ],
            {
              hasNextPage: true,
            },
          ),
          totalCount: 2,
        },
      },
    };
    userPostsTech.user.posts.edges[0].score = 0.5;
    userPostsTech.user.posts.edges[1].score = 0.7;

    const userPostsLifestyle = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection(
            [
              {
                id: "p3",
                title: "Post 3",
                flags: [],
                author: {
                  __typename: "User",
                  id: "u1",
                },
              },
              {
                id: "p4",
                title: "Post 4",
                flags: [],
                author: {
                  __typename: "User",
                  id: "u1",
                },
              },
            ],
            {
              startCursor: "p3",
              endCursor: "p4",
            },
          ),
          totalCount: 1,
        },
      },
    };
    userPostsLifestyle.user.posts.edges[0].score = 0.3;
    userPostsLifestyle.user.posts.edges[1].score = 0.6;

    documents.normalizeDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
      data: userPostsTech,
    });

    documents.normalizeDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "lifestyle", postsFirst: 2, postsAfter: null },
      data: userPostsLifestyle,
    });

    expect(graph.getRecord("User:u1")).toEqual({
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      'posts({"after":null,"category":"tech","first":2})': {
        __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2})',
      },
      'posts({"after":null,"category":"lifestyle","first":2})': {
        __ref: '@.User:u1.posts({"after":null,"category":"lifestyle","first":2})',
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2})')).toEqual({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: '@.User:u1.posts({"after":null,"category":"tech","first":2}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges:0',
          '@.User:u1.posts({"after":null,"category":"tech","first":2}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":2}).edges:0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      score: 0.5,
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"lifestyle","first":2})')).toEqual({
      __typename: "PostConnection",
      totalCount: 1,
      pageInfo: {
        __ref: '@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges:0',
          '@.User:u1.posts({"after":null,"category":"lifestyle","first":2}).edges:1',
        ],
      },
    });
  });

  it.only("normalizes root users connection plus nested per-user posts connections", () => {
    const usersPostsData = {
      users: {
        ...users.buildConnection(
          [
            {
              id: "u1",
              email: "u1@example.com",
            },
            {
              id: "u2",
              email: "u2@example.com",
            },
          ],
          {
            hasNextPage: true,
          },
        ),
      },
    };

    usersPostsData.users.edges[0].node.posts = posts.buildConnection([
      {
        id: "p1",
        title: "Post 1",
        flags: [],
      },
    ]);

    usersPostsData.users.edges[1].node.posts = posts.buildConnection(
      [],
      {
        startCursor: null,
        endCursor: null,
      },
    );

    console.log("usersPostsData", JSON.stringify(usersPostsData, null, 2));

    documents.normalizeDocument({
      document: operations.USERS_POSTS_QUERY,
      variables: {
        usersRole: "dj",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
      },
      data: usersPostsData,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"after":null,"first":2,"role":"dj"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"after":null,"first":2,"role":"dj"}).edges:0',
          '@.users({"after":null,"first":2,"role":"dj"}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"dj"}).edges:1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.User:u2.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u2.posts({"after":null,"category":"tech","first":1}).pageInfo',
      },
      edges: {
        __refs: [],
      },
    });
  });

  it.only("normalizes nested posts and comments connections as separate records", () => {
    const userPostsComments_page1 = {
      user: {
        ...users.buildNode({
          id: "u1",
          email: "u1@example.com",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              flags: [],
            },
          ]),
        },
      },
    };

    userPostsComments_page1.user.posts.edges[0].node.comments = comments.buildConnection(
      [
        {
          uuid: "c1",
          text: "Comment 1",
          author: {
            __typename: "User",
            id: "u2",
          },
        },
        {
          uuid: "c2",
          text: "Comment 2",
          author: {
            __typename: "User",
            id: "u3",
          },
        },
      ],
      {
        hasNextPage: true,
      },
    );

    const userPostsComments_page2 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              flags: [],
            },
          ]),
        },
      },
    };

    userPostsComments_page2.user.posts.edges[0].node.comments = comments.buildConnection([
      {
        uuid: "c3",
        text: "Comment 3",
        author: {
          __typename: "User",
          id: "u2",
        },
      },
    ]);

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
      data: userPostsComments_page1,
    });

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c2",
      },
      data: userPostsComments_page2,
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"after":null,"first":2}).pageInfo',
      },
      edges: {
        __refs: [
          '@.Post:p1.comments({"after":null,"first":2}).edges:0',
          '@.Post:p1.comments({"after":null,"first":2}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"after":"c2","first":1}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.comments({"after":"c2","first":1}).edges:0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges:1')).toEqual({
      __typename: "CommentEdge",
      cursor: "c2",
      node: {
        __ref: "Comment:c2",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c3",
      node: {
        __ref: "Comment:c3",
      },
    });

    expect(graph.getRecord("Comment:c1")).toEqual({
      __typename: "Comment",
      uuid: "c1",
      text: "Comment 1",
      author: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord("Comment:c2")).toEqual({
      __typename: "Comment",
      uuid: "c2",
      text: "Comment 2",
      author: {
        __ref: "User:u3",
      },
    });

    expect(graph.getRecord("Comment:c3")).toEqual({
      __typename: "Comment",
      uuid: "c3",
      text: "Comment 3",
      author: {
        __ref: "User:u2",
      },
    });
  });

  it.only("normalizes root users connection and nested posts plus comments connections", () => {
    const usersPostsCommentsData = {
      users: {
        ...users.buildConnection(
          [
            {
              id: "u1",
              email: "u1@example.com",
            },
          ],
          {
            hasNextPage: true,
          },
        ),
      },
    };

    usersPostsCommentsData.users.edges[0].node.posts = {
      ...posts.buildConnection([
        {
          id: "p1",
          title: "Post 1",
          flags: [],
        },
      ]),
    };

    usersPostsCommentsData.users.edges[0].node.posts.edges[0].node.comments = comments.buildConnection([
      {
        uuid: "c1",
        text: "Comment 1",
      },
    ]);

    documents.normalizeDocument({
      document: operations.USERS_POSTS_COMMENTS_QUERY,
      variables: {
        usersRole: "admin",
        usersFirst: 2,
        usersAfter: null,
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: null,
      },
      data: usersPostsCommentsData,
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"after":null,"first":2,"role":"admin"}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"after":null,"first":2,"role":"admin"}).edges:0'],
      },
    });

    expect(graph.getRecord('@.users({"after":null,"first":2,"role":"admin"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"after":null,"category":"tech","first":1}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"after":null,"category":"tech","first":1}).edges:0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":1})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"after":null,"first":1}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.comments({"after":null,"first":1}).edges:0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":1}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });
  });

  it.only("normalizes mutation operations correctly", () => {
    const updateUserData = {
      updateUser: {
        user: {
          ...users.buildNode({
            id: "u1",
            email: "u1_updated@example.com",
          }),
          posts: posts.buildConnection([
            {
              id: "p1",
              title: "Post 1",
              flags: [],
            },
          ]),
        },
      },
    };

    documents.normalizeDocument({
      document: operations.UPDATE_USER_MUTATION,
      variables: {
        input: {
          id: "u1",
          email: "u1_updated@example.com",
        },
      },
      data: updateUserData,
    });

    expect(graph.getRecord("@")).toEqual({
      id: "@",
      __typename: "@",
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1_updated@example.com",
    });
  });

  it.only("normalizes subscription operations correctly", () => {
    const userUpdatedData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "u1_subscribed@example.com",
        }),
      },
    };

    documents.normalizeDocument({
      document: operations.USER_UPDATED_SUBSCRIPTION,
      variables: {
        id: "u1",
      },
      data: userUpdatedData,
    });

    expect(graph.getRecord("@")).toEqual({
      id: "@",
      __typename: "@",
    });

    expect(graph.getRecord("User:u1")).toEqual({
      id: "u1",
      __typename: "User",
      email: "u1_subscribed@example.com",
    });
  });

  it("appends after cursor and prepends before cursor in canonical infinite mode", () => {
    const adminUsersLeaderData = {
      users: users.buildConnection(
        [
          {
            id: "u1",
          },
          {
            id: "u2",
          },
        ],
        {
          hasNextPage: true,
        },
      ),
    };
    adminUsersLeaderData.users.totalCount = 2;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "admin",
        first: 2,
        after: null,
      },
      data: adminUsersLeaderData,
    });

    const adminUsersAfterData = {
      users: users.buildConnection(
        [
          {
            id: "u3",
          },
        ],
        {
          startCursor: "u3",
          endCursor: "u3",
          hasNextPage: true,
        },
      ),
    };
    adminUsersAfterData.users.totalCount = 3;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "admin",
        first: 2,
        after: "u2",
      },
      data: adminUsersAfterData,
    });

    const adminUsersBeforeData = {
      users: users.buildConnection(
        [
          {
            id: "u0",
          },
        ],
        {
          startCursor: "u0",
          endCursor: "u0",
          hasNextPage: false,
          hasPreviousPage: true,
        },
      ),
    };
    adminUsersBeforeData.users.totalCount = 99;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "admin",
        last: 1,
        before: "u1",
      } as any,
      data: adminUsersBeforeData,
    });

    const adminUsersConnection = graph.getRecord('@connection.users({"role":"admin"})')!;

    expect(adminUsersConnection.edges).toEqual({
      __refs: expect.any(Array),
    });

    const canonicalEdges = adminUsersConnection.edges.__refs;
    expect(canonicalEdges.length).toBe(4);

    expect(graph.getRecord(canonicalEdges[0])!).toEqual({
      __typename: "UserEdge",
      cursor: "u0",
      node: {
        __ref: "User:u0",
      },
    });

    expect(graph.getRecord(canonicalEdges[1])!).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord(canonicalEdges[2])!).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord(canonicalEdges[3])!).toEqual({
      __typename: "UserEdge",
      cursor: "u3",
      node: {
        __ref: "User:u3",
      },
    });

    expect(graph.getRecord('@connection.users({"role":"admin"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "u0",
      endCursor: "u3",
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("appends after cursor and prepends before cursor in canonical page mode", () => {
    const moderatorUsersLeaderData = {
      users: users.buildConnection(
        [
          {
            id: "m1",
            email: "m1@example.com",
          },
          {
            id: "m2",
            email: "m2@example.com",
          },
        ],
        {
          startCursor: "m1",
          endCursor: "m2",
          hasNextPage: true,
        },
      ),
    };
    moderatorUsersLeaderData.users.totalCount = 10;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "moderator",
        first: 2,
        after: null,
      },
      data: moderatorUsersLeaderData,
    });

    const moderatorUsersAfterData = {
      users: users.buildConnection(
        [
          {
            id: "m3",
            email: "m3@example.com",
          },
          {
            id: "m4",
            email: "m4@example.com",
          },
        ],
        {
          startCursor: "m3",
          endCursor: "m4",
          hasNextPage: true,
        },
      ),
    };
    moderatorUsersAfterData.users.totalCount = 12;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "moderator",
        first: 2,
        after: "m2",
      },
      data: moderatorUsersAfterData,
    });

    const moderatorUsersBeforeData = {
      users: users.buildConnection(
        [
          {
            id: "m0",
            email: "m0@example.com",
          },
        ],
        {
          startCursor: "m0",
          endCursor: "m0",
          hasNextPage: false,
          hasPreviousPage: true,
        },
      ),
    };
    moderatorUsersBeforeData.users.totalCount = 1;

    documents.normalizeDocument({
      document: operations.USERS_QUERY,
      variables: {
        role: "moderator",
        last: 1,
        before: "m3",
      } as any,
      data: moderatorUsersBeforeData,
    });

    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"moderator"})')).toEqual({
      __typename: "UserConnection",
      totalCount: 12,
      pageInfo: {
        __ref: '@.users({"after":"m2","first":2,"role":"moderator"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"after":"m2","first":2,"role":"moderator"}).edges:0',
          '@.users({"after":"m2","first":2,"role":"moderator"}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"moderator"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "m3",
      endCursor: "m4",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"moderator"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "m3",
      node: {
        __ref: "User:m3",
      },
    });

    expect(graph.getRecord('@.users({"after":"m2","first":2,"role":"moderator"}).edges:1')).toEqual({
      __typename: "UserEdge",
      cursor: "m4",
      node: {
        __ref: "User:m4",
      },
    });

    expect(graph.getRecord('@.users({"before":"m3","last":1,"role":"moderator"})')).toEqual({
      __typename: "UserConnection",
      totalCount: 1,
      pageInfo: {
        __ref: '@.users({"before":"m3","last":1,"role":"moderator"}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"before":"m3","last":1,"role":"moderator"}).edges:0'],
      },
    });

    expect(graph.getRecord('@.users({"before":"m3","last":1,"role":"moderator"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "m0",
      endCursor: "m0",
      hasNextPage: false,
      hasPreviousPage: true,
    });

    expect(graph.getRecord('@.users({"before":"m3","last":1,"role":"moderator"}).edges:0')).toEqual({
      __typename: "UserEdge",
      cursor: "m0",
      node: {
        __ref: "User:m0",
      },
    });
  });

  it("appends after cursor in canonical nested comments infinite mode", () => {
    const user1PostsComments_page1 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
            },
          ]),
        },
      },
    };

    user1PostsComments_page1.user.posts.edges[0].node.comments = {
      ...comments.buildConnection(
        [
          {
            uuid: "c1",
          },
          {
            uuid: "c2",
          },
        ],
        {
          startCursor: "c1",
          endCursor: "c2",
          hasNextPage: true,
        },
      ),
      totalCount: 2,
    };

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
      data: user1PostsComments_page1,
    });

    const user1PostsCommentsAfterData = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
            },
          ]),
        },
      },
    };

    user1PostsCommentsAfterData.user.posts.edges[0].node.comments = {
      ...comments.buildConnection(
        [
          {
            uuid: "c3",
            text: "Comment 3",
          },
        ],
        {
          startCursor: "c3",
          endCursor: "c3",
          hasNextPage: true,
        },
      ),
      totalCount: 3,
    };

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 1,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c2",
      },
      data: user1PostsCommentsAfterData,
    });

    const post1CommentsConnection = graph.getRecord("@connection.Post:p1.comments({})")!;

    expect(post1CommentsConnection.totalCount).toBe(3);

    expect(post1CommentsConnection.edges).toEqual({
      __refs: [
        '@.Post:p1.comments({"after":null,"first":2}).edges:0',
        '@.Post:p1.comments({"after":null,"first":2}).edges:1',
        '@.Post:p1.comments({"after":"c2","first":1}).edges:0',
      ],
    });

    const canonicalEdges = post1CommentsConnection.edges.__refs;

    expect(canonicalEdges.length).toBe(3);

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":null,"first":2}).edges:1')).toEqual({
      __typename: "CommentEdge",
      cursor: "c2",
      node: {
        __ref: "Comment:c2",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"after":"c2","first":1}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c3",
      node: {
        __ref: "Comment:c3",
      },
    });

    expect(graph.getRecord("@connection.Post:p1.comments({}).pageInfo")).toEqual({
      __typename: "PageInfo",
      startCursor: "c1",
      endCursor: "c3",
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it("replaces edges for each page in canonical nested comments page mode", () => {
    const post9CommentsLeaderData = {
      post: {
        ...posts.buildNode({
          id: "p9",
        }),
        comments: {
          ...comments.buildConnection(
            [
              {
                uuid: "x1",
              },
              {
                uuid: "x2",
              },
            ],
            {
              startCursor: "x1",
              endCursor: "x2",
              hasNextPage: true,
            },
          ),
          totalCount: 10,
        },
      },
    };

    documents.normalizeDocument({
      document: operations.POST_COMMENTS_QUERY,
      variables: {
        postId: "p9",
        first: 2,
        after: null,
      },
      data: post9CommentsLeaderData,
    });

    const post9CommentsConnection = graph.getRecord("@connection.Post:p9.comments({})")!;

    expect(post9CommentsConnection.totalCount).toBe(10);

    expect(post9CommentsConnection.edges).toEqual({
      __refs: [
        '@.Post:p9.comments({"after":null,"first":2}).edges:0',
        '@.Post:p9.comments({"after":null,"first":2}).edges:1',
      ],
    });

    expect(graph.getRecord('@.Post:p9.comments({"after":null,"first":2}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "x1",
      node: {
        __ref: "Comment:x1",
      },
    });

    expect(graph.getRecord('@.Post:p9.comments({"after":null,"first":2}).edges:1')).toEqual({
      __typename: "CommentEdge",
      cursor: "x2",
      node: {
        __ref: "Comment:x2",
      },
    });

    expect(graph.getRecord("@connection.Post:p9.comments({}).pageInfo")).toEqual({
      __typename: "PageInfo",
      startCursor: "x1",
      endCursor: "x2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const post9CommentsAfterData = {
      post: {
        ...posts.buildNode({
          id: "p9",
        }),
        comments: {
          ...comments.buildConnection(
            [
              {
                uuid: "x3",
              },
              {
                uuid: "x4",
              },
            ],
            {
              startCursor: "x3",
              endCursor: "x4",
              hasNextPage: false,
              hasPreviousPage: true,
            },
          ),
          totalCount: 12,
        },
      },
    };

    documents.normalizeDocument({
      document: operations.POST_COMMENTS_QUERY,
      variables: {
        postId: "p9",
        first: 2,
        after: "x2",
      },
      data: post9CommentsAfterData,
    });

    const post9CommentsAfterPage = graph.getRecord("@connection.Post:p9.comments({})")!;

    expect(post9CommentsAfterPage.totalCount).toBe(12);
    expect(post9CommentsAfterPage.edges).toEqual({
      __refs: [
        '@.Post:p9.comments({"after":"x2","first":2}).edges:0',
        '@.Post:p9.comments({"after":"x2","first":2}).edges:1',
      ],
    });

    expect(graph.getRecord('@.Post:p9.comments({"after":"x2","first":2}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "x3",
      node: {
        __ref: "Comment:x3",
      },
    });

    expect(graph.getRecord('@.Post:p9.comments({"after":"x2","first":2}).edges:1')).toEqual({
      __typename: "CommentEdge",
      cursor: "x4",
      node: {
        __ref: "Comment:x4",
      },
    });

    expect(graph.getRecord("@connection.Post:p9.comments({}).pageInfo")).toEqual({
      __typename: "PageInfo",
      startCursor: "x3",
      endCursor: "x4",
      hasNextPage: false,
      hasPreviousPage: true,
    });

    const post9CommentsBeforeData = {
      post: {
        ...posts.buildNode({
          id: "p9",
        }),
        comments: comments.buildConnection(
          [
            {
              uuid: "x0",
            },
          ],
          {
            startCursor: "x0",
            endCursor: "x0",
            hasNextPage: false,
            hasPreviousPage: true,
          },
        ),
      },
    };
    post9CommentsBeforeData.post.comments.totalCount = 1;

    documents.normalizeDocument({
      document: operations.POST_COMMENTS_QUERY,
      variables: {
        postId: "p9",
        last: 1,
        before: "x3",
      } as any,
      data: post9CommentsBeforeData,
    });

    const post9CommentsBeforePage = graph.getRecord("@connection.Post:p9.comments({})")!;

    expect(post9CommentsBeforePage.totalCount).toBe(1);
    expect(post9CommentsBeforePage.edges).toEqual({
      __refs: ['@.Post:p9.comments({"before":"x3","last":1}).edges:0'],
    });

    expect(graph.getRecord('@.Post:p9.comments({"before":"x3","last":1}).edges:0')).toEqual({
      __typename: "CommentEdge",
      cursor: "x0",
      node: {
        __ref: "Comment:x0",
      },
    });

    expect(graph.getRecord("@connection.Post:p9.comments({}).pageInfo")).toEqual({
      __typename: "PageInfo",
      startCursor: "x0",
      endCursor: "x0",
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it("merges nested comments independently per parent with anchored pageInfo", () => {
    const user1PostsComments_page1 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
            },
          ]),
        },
      },
    };

    user1PostsComments_page1.user.posts.edges[0].node.comments = comments.buildConnection(
      [
        {
          uuid: "c1",
        },
        {
          uuid: "c2",
        },
      ],
      {
        startCursor: "c1",
        endCursor: "c2",
        hasNextPage: true,
      },
    );

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_WITH_KEY_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 2,
        commentsAfter: null,
      },
      data: user1PostsComments_page1,
    });

    const user1PostsComments_page2 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p2",
            },
          ]),
        },
      },
    };

    user1PostsComments_page2.user.posts.edges[0].node.comments = comments.buildConnection(
      [
        {
          uuid: "c9",
        },
      ],
      {
        startCursor: "c9",
        endCursor: "c9",
      },
    );

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_WITH_KEY_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: null,
      },
      data: user1PostsComments_page2,
    });

    const user1PostsComments_page3 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p1",
            },
          ]),
        },
      },
    };

    user1PostsComments_page3.user.posts.edges[0].node.comments = comments.buildConnection([
      {
        uuid: "c3",
      },
    ]);

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_WITH_KEY_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c2",
      },
      data: user1PostsComments_page3,
    });

    const user1PostsComments_page4 = {
      user: {
        ...users.buildNode({
          id: "u1",
        }),
        posts: {
          ...posts.buildConnection([
            {
              id: "p2",
            },
          ]),
        },
      },
    };

    user1PostsComments_page4.user.posts.edges[0].node.comments = comments.buildConnection([
      {
        uuid: "c10",
      },
    ]);

    documents.normalizeDocument({
      document: operations.USER_POSTS_COMMENTS_WITH_KEY_QUERY,
      variables: {
        id: "u1",
        postsCategory: "tech",
        postsFirst: 2,
        postsAfter: null,
        commentsFirst: 1,
        commentsAfter: "c9",
      },
      data: user1PostsComments_page4,
    });

    expect(graph.getRecord("Post:p1")).toEqual({
      __typename: "Post",
      id: "p1",
      'comments({"after":"c2","first":1})': {
        __ref: '@.Post:p1.comments({"after":"c2","first":1})',
      },
      'comments({"after":null,"first":2})': {
        __ref: '@.Post:p1.comments({"after":null,"first":2})',
      },
    });

    expect(graph.getRecord("Post:p2")).toEqual({
      __typename: "Post",
      id: "p2",
      'comments({"after":"c9","first":1})': {
        __ref: '@.Post:p2.comments({"after":"c9","first":1})',
      },
      'comments({"after":null,"first":1})': {
        __ref: '@.Post:p2.comments({"after":null,"first":1})',
      },
    });

    const post1CommentsConnection = graph.getRecord("@connection.Post:p1.CustomComments({})");

    const post1Edges = post1CommentsConnection.edges.__refs;

    const post1CommentIds = post1Edges.map((edgeRef: string) => {
      const edge = graph.getRecord(edgeRef);
      const node = graph.getRecord(edge.node.__ref);

      return node.id;
    });

    const post1PageInfo = graph.getRecord(post1CommentsConnection.pageInfo.__ref);

    expect(post1CommentIds).toEqual(["c1", "c2", "c3"]);
    expect(post1PageInfo.startCursor).toBe("c1");
    expect(post1PageInfo.endCursor).toBe("c3");

    const post2CommentsConnection = graph.getRecord("@connection.Post:p2.CustomComments({})");

    const post2Edges = post2CommentsConnection.edges.__refs;

    const post2CommentIds = post2Edges.map((edgeRef: string) => {
      const edge = graph.getRecord(edgeRef);
      const node = graph.getRecord(edge.node.__ref);

      return node.id;
    });

    const post2PageInfo = graph.getRecord(post2CommentsConnection.pageInfo.__ref);

    expect(post2CommentIds).toEqual(["c9", "c10"]);
    expect(post2PageInfo.startCursor).toBe("c9");
    expect(post2PageInfo.endCursor).toBe("c10");
  });

  it("stores and links entities by custom key (slug) when id is absent", () => {
    graph.putRecord("@", {
      id: "@",
      __typename: "@",
    });

    const PROFILE_QUERY = `
      query Profile($slug: String!) {
        profile(slug: $slug) {
          slug
          name
        }
      }
    `;

    documents.normalizeDocument({
      document: PROFILE_QUERY,
      variables: {
        slug: "dimitri",
      },
      data: {
        __typename: "Query",
        profile: {
          __typename: "Profile",
          slug: "dimitri",
          name: "Dimitri",
        },
      },
    });

    const profile = graph.getRecord("Profile:dimitri");

    expect(profile).toBeTruthy();
    expect(profile.name).toBe("Dimitri");
  });

  it.only("normalizes aggregations connections", () => {
    documents.normalizeDocument({
      document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
      variables: {
        first: 2,
        after: null,
      },
      data: {
        __typename: "Query",
        posts: {
          __typename: "PostConnection",
          totalCount: 2,
          ...posts.buildConnection(
            [
              {
                id: "p1",
                title: "Video 1",
                flags: [],
                typename: "VideoPost",
                aggregations: {
                  __typename: "Aggregations",
                  moderationTags: tags.buildConnection([
                    {
                      id: "t1",
                      name: "mod-1",
                    },
                  ]),
                  userTags: tags.buildConnection([
                    {
                      id: "tu1",
                      name: "user-1",
                    },
                  ]),
                },
                video: medias.buildNode({
                  key: "m1",
                  mediaUrl: "https://m/1",
                }),
              },
              {
                id: "p2",
                title: "Audio 2",
                flags: [],
                typename: "AudioPost",
                aggregations: {
                  __typename: "Aggregations",
                  moderationTags: tags.buildConnection([
                    {
                      id: "t2",
                      name: "mod-2",
                    },
                  ]),
                  userTags: tags.buildConnection([
                    {
                      id: "tu2",
                      name: "user-2",
                    },
                  ]),
                },
                audio: medias.buildNode({
                  key: "m2",
                  mediaUrl: "https://m/2",
                }),
              },
            ],
            {
              startCursor: "p1",
              endCursor: "p2",
              hasNextPage: false,
              hasPreviousPage: false,
            },
          ),
          aggregations: {
            __typename: "Aggregations",
            scoring: 88,
            todayStat: {
              __typename: "Stat",
              key: "today",
              views: 123,
            },
            yesterdayStat: {
              __typename: "Stat",
              key: "yesterday",
              views: 95,
            },
            tags: tags.buildConnection([
              {
                id: "t1",
                name: "mod-1",
              },
              {
                id: "t2",
                name: "mod-2",
              },
            ]),
          },
        },
      },
    });

    expect(graph.getRecord('@.posts({"after":null,"first":2})')).toEqual({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: '@.posts({"after":null,"first":2}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"after":null,"first":2}).edges:0',
          '@.posts({"after":null,"first":2}).edges:1',
        ],
      },
      aggregations: {
        __ref: '@.posts({"after":null,"first":2}).aggregations',
      },
    });

    expect(graph.getRecord('@.posts({"after":null,"first":2}).aggregations')).toEqual({
      __typename: "Aggregations",
      scoring: 88,
      'stat({"key":"today"})': {
        __ref: "Stat:today",
      },
      'stat({"key":"yesterday"})': {
        __ref: "Stat:yesterday",
      },
      'tags({"first":50})': {
        __ref: '@.posts({"after":null,"first":2}).aggregations.tags({"first":50})',
      },
    });

    expect(graph.getRecord("Stat:today")).toEqual({
      __typename: "Stat",
      key: "today",
      views: 123,
    });

    expect(graph.getRecord("Stat:yesterday")).toEqual({
      __typename: "Stat",
      key: "yesterday",
      views: 95,
    });

    expect(graph.getRecord('@.posts({"after":null,"first":2}).aggregations.tags({"first":50})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0',
          '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1',
        ],
      },
    });

    expect(graph.getRecord('@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t1",
      },
    });

    expect(graph.getRecord('@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t2",
      },
    });

    expect(graph.getRecord("Post:p1")).toEqual({
      __typename: "VideoPost",
      id: "p1",
      title: "Video 1",
      flags: [],
      video: {
        __ref: "Media:m1",
      },
      aggregations: {
        __ref: "Post:p1.aggregations",
      },
    });

    expect(graph.getRecord("Post:p1.aggregations")).toEqual({
      __typename: "Aggregations",
      'tags({"category":"moderation","first":25})': {
        __ref: '@.Post:p1.aggregations.tags({"category":"moderation","first":25})',
      },
      'tags({"category":"user","first":25})': {
        __ref: '@.Post:p1.aggregations.tags({"category":"user","first":25})',
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"category":"moderation","first":25})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t1",
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"category":"user","first":25})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.Post:p1.aggregations.tags({"category":"user","first":25}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:tu1",
      },
    });

    expect(graph.getRecord("Media:m1")).toEqual({
      __typename: "Media",
      key: "m1",
      mediaUrl: "https://m/1",
    });

    expect(graph.getRecord("Post:p2")).toEqual({
      __typename: "AudioPost",
      id: "p2",
      title: "Audio 2",
      flags: [],
      audio: {
        __ref: "Media:m2",
      },
      aggregations: {
        __ref: "Post:p2.aggregations",
      },
    });

    expect(graph.getRecord("Post:p2.aggregations")).toEqual({
      __typename: "Aggregations",
      'tags({"category":"moderation","first":25})': {
        __ref: '@.Post:p2.aggregations.tags({"category":"moderation","first":25})',
      },
      'tags({"category":"user","first":25})': {
        __ref: '@.Post:p2.aggregations.tags({"category":"user","first":25})',
      },
    });

    expect(graph.getRecord('@.Post:p2.aggregations.tags({"category":"moderation","first":25}).edges:0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t2",
      },
    });

    expect(graph.getRecord('@.Post:p2.aggregations.tags({"category":"user","first":25}).edges:0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:tu2",
      },
    });

    expect(graph.getRecord("Media:m2")).toEqual({
      __typename: "Media",
      key: "m2",
      mediaUrl: "https://m/2",
    });
    /*
    expect(graph.getRecord("@connection.posts({})")).toMatchObject({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: "@connection.posts({}).pageInfo",
      },
      edges: {
        __refs: [
          '@.posts({"after":null,"first":2}).edges:0',
          '@.posts({"after":null,"first":2}).edges:1',
        ],
      },
      aggregations: {
        __ref: "@connection.posts({}).aggregations",
      },
    });

    expect(graph.getRecord("@connection.posts({}).aggregations")).toEqual({
      __typename: "Aggregations",
      scoring: 88,
      'stat({"key":"today"})': {
        __ref: "Stat:today",
      },
      'stat({"key":"yesterday"})': {
        __ref: "Stat:yesterday",
      },
      "BaseTags({})": {
        __ref: "@connection.posts({}).aggregations.BaseTags({})",
      },
    });

    expect(graph.getRecord("@connection.posts({}).aggregations.BaseTags({})")).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: "@connection.posts({}).aggregations.BaseTags({}).pageInfo",
      },
      edges: {
        __refs: [
          '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0',
          '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1',
        ],
      },
    });

    expect(graph.getRecord("@connection.posts({}).aggregations.BaseTags({})::meta")).toBeDefined();

    expect(graph.getRecord('@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0'],
      },
    });

    expect(graph.getRecord('@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"})::meta')).toBeDefined();

    expect(graph.getRecord('@connection.Post:p1.aggregations.UserTags({"category":"user"})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@connection.Post:p1.aggregations.UserTags({"category":"user"}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0'],
      },
    });

    expect(graph.getRecord('@connection.Post:p1.aggregations.UserTags({"category":"user"})::meta')).toBeDefined();

    expect(graph.getRecord('@connection.Post:p2.aggregations.ModerationTags({"category":"moderation"})::meta')).toBeDefined();
    expect(graph.getRecord('@connection.Post:p2.aggregations.UserTags({"category":"user"})::meta')).toBeDefined(); */
  });
});
