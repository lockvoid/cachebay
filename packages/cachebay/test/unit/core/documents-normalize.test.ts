import { createCanonical } from "@/src/core/canonical";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createOptimistic } from "@/src/core/optimistic";
import { createPlanner } from "@/src/core/planner";
import { operations } from "@/test/helpers";
import { users, posts, comments, tags, medias } from "@/test/helpers/fixtures";

describe("documents.normalize", () => {
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
      onChange: () => {
        // No-op for these tests
      },
    });

    optimistic = createOptimistic({ graph });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic });
    documents = createDocuments({ graph, canonical, planner });
  });

  describe('primitives', () => {
    it('normalizes string', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              data
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            data: "string",
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        data: "string",
      });
    });

    it('normalizes number', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              data
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            data: 123,
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        data: 123,
      });
    });

    it('normalizes boolean', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              data
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            data: true,
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        data: true,
      });
    });

    it('normalizes null', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              data
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            data: null,
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        data: null,
      });
    });

    it('normalizes json', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              data
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            data: { foo: { bar: "baz" } },
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        data: { foo: { bar: "baz" } },
      });
    });
  });

  describe('aliases', () => {
    it('normalizes without aliases', () => {
      documents.normalize({
        document: `
          query {
            entity(id: "e1") {
              id
              dataUrl
              previewUrl: dataUrl(variant: "preview")
            }
          }
        `,

        data: {
          entity: {
            __typename: "Entity",
            id: "e1",
            dataUrl: "1",
            previewUrl: "2",
          }
        },
      });

      expect(graph.getRecord("Entity:e1")).toEqual({
        __typename: "Entity",
        id: "e1",
        "dataUrl": "1",
        'dataUrl({"variant":"preview"})': "2",
      });
    });
  });

  it("normalizes root users connection with edge records", () => {
    documents.normalize({
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

    documents.normalize({
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

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"role":"admin","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"role":"admin","first":2,"after":null}).edges.0',
          '@.users({"role":"admin","first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null}).edges.1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":"u2"})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"role":"admin","first":2,"after":"u2"}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"role":"admin","first":2,"after":"u2"}).edges.0'],
      },
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":"u2"}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u3",
      node: {
        __ref: "User:u3",
      },
    });

    // Canonical connection (merged, no meta assertions)
    const canonicalUsers = graph.getRecord('@connection.users({"role":"admin"})');
    expect(canonicalUsers).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@connection.users({"role":"admin"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"role":"admin","first":2,"after":null}).edges.0',
          '@.users({"role":"admin","first":2,"after":null}).edges.1',
          '@.users({"role":"admin","first":2,"after":"u2"}).edges.0',
        ],
      },
    });
  });

  it("preserves both category connections when writing posts", () => {
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

    documents.normalize({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
      data: userPostsTech,
    });

    documents.normalize({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "lifestyle", postsFirst: 2, postsAfter: null },
      data: userPostsLifestyle,
    });

    expect(graph.getRecord("User:u1")).toEqual({
      __typename: "User",
      id: "u1",
      email: "u1@example.com",
      'posts({"category":"tech","first":2,"after":null})': {
        __ref: '@.User:u1.posts({"category":"tech","first":2,"after":null})',
      },
      'posts({"category":"lifestyle","first":2,"after":null})': {
        __ref: '@.User:u1.posts({"category":"lifestyle","first":2,"after":null})',
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":2,"after":null})')).toEqual({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: '@.User:u1.posts({"category":"tech","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"category":"tech","first":2,"after":null}).edges.0',
          '@.User:u1.posts({"category":"tech","first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":2,"after":null}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      score: 0.5,
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"lifestyle","first":2,"after":null})')).toEqual({
      __typename: "PostConnection",
      totalCount: 1,
      pageInfo: {
        __ref: '@.User:u1.posts({"category":"lifestyle","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"category":"lifestyle","first":2,"after":null}).edges.0',
          '@.User:u1.posts({"category":"lifestyle","first":2,"after":null}).edges.1',
        ],
      },
    });

    // Canonical connections for both categories (no meta assertions)
    const canonicalTech = graph.getRecord('@connection.User:u1.posts({"category":"tech"})');
    expect(canonicalTech).toEqual({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: '@connection.User:u1.posts({"category":"tech"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"category":"tech","first":2,"after":null}).edges.0',
          '@.User:u1.posts({"category":"tech","first":2,"after":null}).edges.1',
        ],
      },
    });

    const canonicalLifestyle = graph.getRecord('@connection.User:u1.posts({"category":"lifestyle"})');
    expect(canonicalLifestyle).toEqual({
      __typename: "PostConnection",
      totalCount: 1,
      pageInfo: {
        __ref: '@connection.User:u1.posts({"category":"lifestyle"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.User:u1.posts({"category":"lifestyle","first":2,"after":null}).edges.0',
          '@.User:u1.posts({"category":"lifestyle","first":2,"after":null}).edges.1',
        ],
      },
    });
  });

  it("normalizes root users connection with neseted posts connections", () => {
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

    documents.normalize({
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

    expect(graph.getRecord('@.users({"role":"dj","first":2,"after":null})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"role":"dj","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"role":"dj","first":2,"after":null}).edges.0',
          '@.users({"role":"dj","first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.users({"role":"dj","first":2,"after":null}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.users({"role":"dj","first":2,"after":null}).edges.1')).toEqual({
      __typename: "UserEdge",
      cursor: "u2",
      node: {
        __ref: "User:u2",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"category":"tech","first":1,"after":null}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.User:u2.posts({"category":"tech","first":1,"after":null})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u2.posts({"category":"tech","first":1,"after":null}).pageInfo',
      },
      edges: {
        __refs: [],
      },
    });

    // Canonical connections (no meta assertions)
    const canonicalDjUsers = graph.getRecord('@connection.users({"role":"dj"})');
    expect(canonicalDjUsers).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@connection.users({"role":"dj"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.users({"role":"dj","first":2,"after":null}).edges.0',
          '@.users({"role":"dj","first":2,"after":null}).edges.1',
        ],
      },
    });

    const canonicalU1Posts = graph.getRecord('@connection.User:u1.posts({"category":"tech"})');
    expect(canonicalU1Posts).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.User:u1.posts({"category":"tech"}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    const canonicalU2Posts = graph.getRecord('@connection.User:u2.posts({"category":"tech"})');
    expect(canonicalU2Posts).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.User:u2.posts({"category":"tech"}).pageInfo',
      },
      edges: {
        __refs: [],
      },
    });
  });

  it("normalizes nested posts and comments connections as separate records", () => {
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

    documents.normalize({
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

    documents.normalize({
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

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"category":"tech","first":1,"after":null}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":2,"after":null})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.Post:p1.comments({"first":2,"after":null}).edges.0',
          '@.Post:p1.comments({"first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":1,"after":"c2"})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"first":1,"after":"c2"}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.comments({"first":1,"after":"c2"}).edges.0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":2,"after":null}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":2,"after":null}).edges.1')).toEqual({
      __typename: "CommentEdge",
      cursor: "c2",
      node: {
        __ref: "Comment:c2",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":1,"after":"c2"}).edges.0')).toEqual({
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

    // Canonical connections (no meta assertions)
    const canonicalU1TechPosts = graph.getRecord('@connection.User:u1.posts({"category":"tech"})');
    expect(canonicalU1TechPosts).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.User:u1.posts({"category":"tech"}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    const canonicalP1Comments = graph.getRecord("@connection.Post:p1.comments({})");
    expect(canonicalP1Comments).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: "@connection.Post:p1.comments({}).pageInfo",
      },
      edges: {
        __refs: [
          '@.Post:p1.comments({"first":2,"after":null}).edges.0',
          '@.Post:p1.comments({"first":2,"after":null}).edges.1',
          '@.Post:p1.comments({"first":1,"after":"c2"}).edges.0',
        ],
      },
    });
  });

  it("normalizes root users connection with nested posts and comments connections", () => {
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

    documents.normalize({
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

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null})')).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@.users({"role":"admin","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"role":"admin","first":2,"after":null}).edges.0'],
      },
    });

    expect(graph.getRecord('@.users({"role":"admin","first":2,"after":null}).edges.0')).toEqual({
      __typename: "UserEdge",
      cursor: "u1",
      node: {
        __ref: "User:u1",
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.User:u1.posts({"category":"tech","first":1,"after":null}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    expect(graph.getRecord('@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":1,"after":null})')).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: '@.Post:p1.comments({"first":1,"after":null}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.comments({"first":1,"after":null}).edges.0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":1,"after":null}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });

    // Canonical connections (no meta assertions)
    const canonicalAdminUsers = graph.getRecord('@connection.users({"role":"admin"})');
    expect(canonicalAdminUsers).toEqual({
      __typename: "UserConnection",
      pageInfo: {
        __ref: '@connection.users({"role":"admin"}).pageInfo',
      },
      edges: {
        __refs: ['@.users({"role":"admin","first":2,"after":null}).edges.0'],
      },
    });

    const canonicalUserPosts = graph.getRecord('@connection.User:u1.posts({"category":"tech"})');
    expect(canonicalUserPosts).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.User:u1.posts({"category":"tech"}).pageInfo',
      },
      edges: {
        __refs: ['@.User:u1.posts({"category":"tech","first":1,"after":null}).edges.0'],
      },
    });

    const canonicalPostComments = graph.getRecord("@connection.Post:p1.comments({})");
    expect(canonicalPostComments).toEqual({
      __typename: "CommentConnection",
      pageInfo: {
        __ref: "@connection.Post:p1.comments({}).pageInfo",
      },
      edges: {
        __refs: ['@.Post:p1.comments({"first":1,"after":null}).edges.0'],
      },
    });
  });

  it("normalizes mutation operations correctly", () => {
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

    documents.normalize({
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

    // Mutations don't create canonical connections at root level
    const keys = graph.keys();
    const canonicalKeys = keys.filter((k) => k.startsWith("@connection"));
    expect(canonicalKeys.length).toBe(0);
  });

  it("normalizes subscription operations correctly", () => {
    const userUpdatedData = {
      userUpdated: {
        __typename: "UserUpdated",
        user: users.buildNode({
          id: "u1",
          email: "u1_subscribed@example.com",
        }),
      },
    };

    documents.normalize({
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

    // Subscriptions don't create canonical connections
    const keys = graph.keys();
    const canonicalKeys = keys.filter((k) => k.startsWith("@connection"));
    expect(canonicalKeys.length).toBe(0);
  });

  it("appends after cursor and prepends before cursor in canonical infinite mode", () => {
    const techPostsLeaderData = {
      posts: posts.buildConnection(
        [
          {
            id: "p1",
            title: "Post 1",
            flags: ["react"],
          },
          {
            id: "p2",
            title: "Post 2",
            flags: ["vue"],
          },
        ],
        {
          startCursor: "p1",
          endCursor: "p2",
          hasNextPage: true,
        },
      ),
    };

    documents.normalize({
      document: operations.POSTS_QUERY,
      variables: {
        category: "tech",
        sort: "recent",
        first: 2,
        after: null,
      },
      data: techPostsLeaderData,
    });

    // After leader fetch, canonical should show initial page
    expect(graph.getRecord('@connection.posts({"category":"tech","sort":"recent"})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.posts({"category":"tech","sort":"recent"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.0',
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@connection.posts({"category":"tech","sort":"recent"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasPreviousPage: false,
      hasNextPage: true,
    });

    const techPostsAfterData = {
      posts: posts.buildConnection(
        [
          {
            id: "p3",
            title: "Post 3",
            flags: ["js"],
          },
          {
            id: "p4",
            title: "Post 4",
            flags: ["ts"],
          },
        ],
        {
          startCursor: "p3",
          endCursor: "p4",
          hasNextPage: true,
        },
      ),
    };

    documents.normalize({
      document: operations.POSTS_QUERY,
      variables: {
        category: "tech",
        sort: "recent",
        first: 2,
        after: "p2",
      },
      data: techPostsAfterData,
    });

    // After "after" fetch, canonical should APPEND the new page
    expect(graph.getRecord('@connection.posts({"category":"tech","sort":"recent"})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.posts({"category":"tech","sort":"recent"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.0',  // p1
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.1',  // p2
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.0',  // p3
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.1',  // p4
        ],
      },
    });

    // PageInfo should reflect the merged view
    expect(graph.getRecord('@connection.posts({"category":"tech","sort":"recent"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "p1",      // From head page
      endCursor: "p4",        // From tail page
      hasPreviousPage: false, // From head page
      hasNextPage: true,      // From tail page
    });

    const techPostsBeforeData = {
      posts: posts.buildConnection(
        [
          {
            id: "p0",
            title: "Post 0",
            flags: ["node"],
          },
        ],
        {
          startCursor: "p0",
          endCursor: "p0",
          hasNextPage: false,
          hasPreviousPage: true,
        },
      ),
    };

    documents.normalize({
      document: operations.POSTS_QUERY,
      variables: {
        category: "tech",
        sort: "recent",
        last: 1,
        before: "p3",
      },
      data: techPostsBeforeData,
    });

    // After "before" fetch, canonical uses splice semantics (keep from the cursor to the end)
    const canonicalTechPosts = graph.getRecord('@connection.posts({"category":"tech","sort":"recent"})');
    expect(canonicalTechPosts).toBeDefined();
    expect(canonicalTechPosts).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@connection.posts({"category":"tech","sort":"recent"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"category":"tech","sort":"recent","last":1,"before":"p3"}).edges.0',   // p0
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.0',   // p3
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.1',   // p4
        ],
      },
    });

    // PageInfo should reflect the current window (head from new page, tail from last page)
    expect(graph.getRecord('@connection.posts({"category":"tech","sort":"recent"}).pageInfo')).toEqual({
      __typename: "PageInfo",
      startCursor: "p0",
      endCursor: "p4",
      hasPreviousPage: true,
      hasNextPage: true,
    });

    // Verify concrete pages still exist independently
    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","first":2,"after":null})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.0',
          '@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.0',
          '@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","last":1,"before":"p3"})')).toEqual({
      __typename: "PostConnection",
      pageInfo: {
        __ref: '@.posts({"category":"tech","sort":"recent","last":1,"before":"p3"}).pageInfo',
      },
      edges: {
        __refs: ['@.posts({"category":"tech","sort":"recent","last":1,"before":"p3"}).edges.0'],
      },
    });

    // Verify individual edge records
    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","first":2,"after":null}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p1",
      node: {
        __ref: "Post:p1",
      },
    });

    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","first":2,"after":"p2"}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p3",
      node: {
        __ref: "Post:p3",
      },
    });

    expect(graph.getRecord('@.posts({"category":"tech","sort":"recent","last":1,"before":"p3"}).edges.0')).toEqual({
      __typename: "PostEdge",
      cursor: "p0",
      node: {
        __ref: "Post:p0",
      },
    });

    // Verify post entities
    expect(graph.getRecord("Post:p1")).toMatchObject({
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      flags: ["react"],
    });

    expect(graph.getRecord("Post:p3")).toMatchObject({
      __typename: "Post",
      id: "p3",
      title: "Post 3",
      flags: ["js"],
    });

    expect(graph.getRecord("Post:p0")).toMatchObject({
      __typename: "Post",
      id: "p0",
      title: "Post 0",
      flags: ["node"],
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

    documents.normalize({
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

    documents.normalize({
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
        '@.Post:p1.comments({"first":2,"after":null}).edges.0',
        '@.Post:p1.comments({"first":2,"after":null}).edges.1',
        '@.Post:p1.comments({"first":1,"after":"c2"}).edges.0',
      ],
    });

    const canonicalEdges = post1CommentsConnection.edges.__refs;

    expect(canonicalEdges.length).toBe(3);

    expect(graph.getRecord('@.Post:p1.comments({"first":2,"after":null}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "c1",
      node: {
        __ref: "Comment:c1",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":2,"after":null}).edges.1')).toEqual({
      __typename: "CommentEdge",
      cursor: "c2",
      node: {
        __ref: "Comment:c2",
      },
    });

    expect(graph.getRecord('@.Post:p1.comments({"first":1,"after":"c2"}).edges.0')).toEqual({
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

    documents.normalize({
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
        '@.Post:p9.comments({"first":2,"after":null}).edges.0',
        '@.Post:p9.comments({"first":2,"after":null}).edges.1',
      ],
    });

    expect(graph.getRecord('@.Post:p9.comments({"first":2,"after":null}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "x1",
      node: {
        __ref: "Comment:x1",
      },
    });

    expect(graph.getRecord('@.Post:p9.comments({"first":2,"after":null}).edges.1')).toEqual({
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

    documents.normalize({
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
        '@.Post:p9.comments({"first":2,"after":"x2"}).edges.0',
        '@.Post:p9.comments({"first":2,"after":"x2"}).edges.1',
      ],
    });

    expect(graph.getRecord('@.Post:p9.comments({"first":2,"after":"x2"}).edges.0')).toEqual({
      __typename: "CommentEdge",
      cursor: "x3",
      node: {
        __ref: "Comment:x3",
      },
    });

    expect(graph.getRecord('@.Post:p9.comments({"first":2,"after":"x2"}).edges.1')).toEqual({
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

    documents.normalize({
      document: operations.POST_COMMENTS_QUERY,
      variables: {
        postId: "p9",
        last: 1,
        before: "x3",
      },
      data: post9CommentsBeforeData,
    });

    const post9CommentsBeforePage = graph.getRecord("@connection.Post:p9.comments({})")!;

    expect(post9CommentsBeforePage.totalCount).toBe(1);
    expect(post9CommentsBeforePage.edges).toEqual({
      __refs: ['@.Post:p9.comments({"last":1,"before":"x3"}).edges.0'],
    });

    expect(graph.getRecord('@.Post:p9.comments({"last":1,"before":"x3"}).edges.0')).toEqual({
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

    documents.normalize({
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

    documents.normalize({
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

    documents.normalize({
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

    documents.normalize({
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
      flags: [],
      'comments({"first":1,"after":"c2"})': {
        __ref: '@.Post:p1.comments({"first":1,"after":"c2"})',
      },
      'comments({"first":2,"after":null})': {
        __ref: '@.Post:p1.comments({"first":2,"after":null})',
      },
    });

    expect(graph.getRecord("Post:p2")).toEqual({
      __typename: "Post",
      id: "p2",
      flags: [],
      'comments({"first":1,"after":"c9"})': {
        __ref: '@.Post:p2.comments({"first":1,"after":"c9"})',
      },
      'comments({"first":1,"after":null})': {
        __ref: '@.Post:p2.comments({"first":1,"after":null})',
      },
    });

    const post1CommentsConnection = graph.getRecord("@connection.Post:p1.CustomComments({})");

    const post1Edges = post1CommentsConnection.edges.__refs;

    const post1CommentIds = post1Edges.map((edgeRef: string) => {
      const edge = graph.getRecord(edgeRef);
      const node = graph.getRecord(edge.node.__ref);

      return node.uuid;
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

      return node.uuid;
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

    documents.normalize({
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

    // No canonical connection for single entity queries
    const keys = graph.keys();
    const canonicalKeys = keys.filter((k) => k.startsWith("@connection"));
    expect(canonicalKeys.length).toBe(0);
  });

  it("normalizes aggregations connections (containers remain non-canonical)", () => {
    documents.normalize({
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

    // Concrete (non-canonical) root page
    expect(graph.getRecord('@.posts({"first":2,"after":null})')).toEqual({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: '@.posts({"first":2,"after":null}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"first":2,"after":null}).edges.0',
          '@.posts({"first":2,"after":null}).edges.1',
        ],
      },
      aggregations: {
        __ref: '@.posts({"first":2,"after":null}).aggregations',
      },
    });

    // Aggregations container stored once (non-canonical)
    expect(graph.getRecord('@.posts({"first":2,"after":null}).aggregations')).toEqual({
      __typename: "Aggregations",
      scoring: 88,
      'stat({"key":"today"})': {
        __ref: "Stat:today",
      },
      'stat({"key":"yesterday"})': {
        __ref: "Stat:yesterday",
      },
      'tags({"first":50})': {
        __ref: '@.posts({"first":2,"after":null}).aggregations.tags({"first":50})',
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

    expect(graph.getRecord('@.posts({"first":2,"after":null}).aggregations.tags({"first":50})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.posts({"first":2,"after":null}).aggregations.tags({"first":50}).pageInfo',
      },
      edges: {
        __refs: [
          '@.posts({"first":2,"after":null}).aggregations.tags({"first":50}).edges.0',
          '@.posts({"first":2,"after":null}).aggregations.tags({"first":50}).edges.1',
        ],
      },
    });

    expect(graph.getRecord('@.posts({"first":2,"after":null}).aggregations.tags({"first":50}).edges.0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t1",
      },
    });

    expect(graph.getRecord('@.posts({"first":2,"after":null}).aggregations.tags({"first":50}).edges.1')).toEqual({
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
      'tags({"first":25,"category":"moderation"})': {
        __ref: '@.Post:p1.aggregations.tags({"first":25,"category":"moderation"})',
      },
      'tags({"first":25,"category":"user"})': {
        __ref: '@.Post:p1.aggregations.tags({"first":25,"category":"user"})',
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"first":25,"category":"moderation"})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.Post:p1.aggregations.tags({"first":25,"category":"moderation"}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"first":25,"category":"moderation"}).edges.0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"first":25,"category":"moderation"}).edges.0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t1",
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"first":25,"category":"user"})')).toEqual({
      __typename: "TagConnection",
      pageInfo: {
        __ref: '@.Post:p1.aggregations.tags({"first":25,"category":"user"}).pageInfo',
      },
      edges: {
        __refs: ['@.Post:p1.aggregations.tags({"first":25,"category":"user"}).edges.0'],
      },
    });

    expect(graph.getRecord('@.Post:p1.aggregations.tags({"first":25,"category":"user"}).edges.0')).toEqual({
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
      'tags({"first":25,"category":"moderation"})': {
        __ref: '@.Post:p2.aggregations.tags({"first":25,"category":"moderation"})',
      },
      'tags({"first":25,"category":"user"})': {
        __ref: '@.Post:p2.aggregations.tags({"first":25,"category":"user"})',
      },
    });

    expect(graph.getRecord('@.Post:p2.aggregations.tags({"first":25,"category":"moderation"}).edges.0')).toEqual({
      __typename: "TagEdge",
      node: {
        __ref: "Tag:t2",
      },
    });

    expect(graph.getRecord('@.Post:p2.aggregations.tags({"first":25,"category":"user"}).edges.0')).toEqual({
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

    // Canonical connection exists, but its containers point to non-canonical pages
    expect(graph.getRecord("@connection.posts({})")).toMatchObject({
      __typename: "PostConnection",
      totalCount: 2,
      pageInfo: {
        __ref: "@connection.posts({}).pageInfo",
      },
      edges: {
        __refs: [
          '@.posts({"first":2,"after":null}).edges.0',
          '@.posts({"first":2,"after":null}).edges.1',
        ],
      },
      aggregations: {
        __ref: '@.posts({"first":2,"after":null}).aggregations',
      },
    });
  });

  it("handles arrays", () => {
    const QUERY = `
      query Query($id: ID!) {
        post(id: $id) {
          __typename
          id
          title
          tags {
            __typename
            id
            name
          }
        }
      }
    `;

    const data1 = {
      post: {
        __typename: "Post",
        id: "p1",
        title: "Post 1",
        tags: [
          tags.buildNode({ id: "t1", name: "Tag 1" }),
          tags.buildNode({ id: "t2", name: "Tag 2" }),
        ],
      },
    };

    documents.normalize({
      document: QUERY,
      variables: { id: "p1" },
      data: data1,
    });

    expect(graph.getRecord('Post:p1')).toEqual({
      __typename: "Post",
      id: "p1",
      title: "Post 1",
      tags: {
        __refs: ["Tag:t1", "Tag:t2"],
      },
    });

    expect(graph.getRecord('Tag:t1')).toEqual({
      __typename: "Tag",
      id: "t1",
      name: "Tag 1",
    });

    expect(graph.getRecord('Tag:t2')).toEqual({
      __typename: "Tag",
      id: "t2",
      name: "Tag 2",
    });
  });
});
