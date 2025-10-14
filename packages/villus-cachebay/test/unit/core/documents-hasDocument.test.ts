import { compilePlan } from "@/src/compiler";
import { createCanonical } from "@/src/core/canonical";
import { ROOT_ID } from "@/src/core/constants";
import { createDocuments } from "@/src/core/documents";
import { createGraph } from "@/src/core/graph";
import { createPlanner } from "@/src/core/planner";
import { createViews } from "@/src/core/views";
import * as operations from "@/test/helpers/operations";
import { writeConnectionPage } from "@/test/helpers";

describe("documents.hasDocument", () => {
  let graph: ReturnType<typeof createGraph>;
  let planner: ReturnType<typeof createPlanner>;
  let canonical: ReturnType<typeof createCanonical>;
  let views: ReturnType<typeof createViews>;
  let documents: ReturnType<typeof createDocuments>;

  beforeEach(() => {
    graph = createGraph({ interfaces: { Post: ["AudioPost", "VideoPost"] } });
    planner = createPlanner();
    canonical = createCanonical({ graph, optimistic: null });
    views = createViews({ graph });
    documents = createDocuments({ graph, views, canonical, planner });
  });

  it("returns true when a root entity link exists", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(true);
  });

  it("returns false when a root entity link is missing", () => {
    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(false);
  });

  it("returns true when the root connection ACTUAL page exists (USERS_QUERY)", () => {
    const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';

    writeConnectionPage(graph, pageKey, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(true);
  });

  it("returns false when the root connection ACTUAL page is missing (USERS_QUERY)", () => {
    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(false);
  });

  it("returns false when multiple root branches have missing parts, then true when both present (MULTIPLE_USERS_QUERY)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const miss = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });
    expect(miss).toBe(false);

    const usersPageKey = '@.users({"after":null,"first":2,"role":"admin"})';
    writeConnectionPage(graph, usersPageKey, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: operations.MULTIPLE_USERS_QUERY,
      variables: { userId: "u1", usersRole: "admin", usersFirst: 2, usersAfter: null },
    });
    expect(ok).toBe(true);
  });

  it("accepts precompiled plan", () => {
    const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';

    writeConnectionPage(graph, pageKey, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: compilePlan(operations.USERS_QUERY),
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(true);
  });

  it("returns false when variables don't match the cached page args", () => {
    const adminPageKey = '@.users({"after":null,"first":2,"role":"admin"})';

    writeConnectionPage(graph, adminPageKey, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const miss = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "moderator", first: 2, after: null },
    });
    expect(miss).toBe(false);

    const modPageKey = '@.users({"after":null,"first":2,"role":"moderator"})';

    writeConnectionPage(graph, modPageKey, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u3",
        endCursor: "u3",
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "moderator", first: 2, after: null },
    });
    expect(ok).toBe(true);
  });

  it("returns false when different pagination args result in different page keys", () => {
    const page1Key = '@.users({"after":null,"first":2,"role":"admin"})';

    writeConnectionPage(graph, page1Key, {
      __typename: "UserConnection",
      edges: [],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const miss = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 5, after: null },
    });
    expect(miss).toBe(false);
  });

  it("returns false when link is present but entity snapshot is missing (strict leaf check)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });

    const ok = documents.hasDocument({
      document: operations.USER_QUERY,
      variables: { id: "u1" },
    });

    expect(ok).toBe(false);
  });

  it("returns false when a nested connection ACTUAL page is missing under a present root link (USER_POSTS_QUERY)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const ok = documents.hasDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(ok).toBe(false);
  });

  it("returns true when the nested connection ACTUAL page exists under the root link (USER_POSTS_QUERY)", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const postsPageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';

    writeConnectionPage(graph, postsPageKey, {
      __typename: "PostConnection",
      totalCount: 0,
      edges: [],
      pageInfo: {
        startCursor: "p1",
        endCursor: "p2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(ok).toBe(true);
  });

  it("returns false when connection page missing totalCount scalar field", () => {
    graph.putRecord(ROOT_ID, {
      id: ROOT_ID,
      __typename: ROOT_ID,
      ['user({"id":"u1"})']: { __ref: "User:u1" },
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1", email: "u1@example.com" });

    const postsPageKey = '@.User:u1.posts({"after":null,"category":"tech","first":2})';
    const pageInfoKey = `${postsPageKey}.pageInfo`;

    graph.putRecord(pageInfoKey, {
      __typename: "PageInfo",
      startCursor: "p1",
      endCursor: "p2",
      hasNextPage: true,
      hasPreviousPage: false,
    });

    graph.putRecord(postsPageKey, {
      __typename: "PostConnection",
      edges: { __refs: [] },
      pageInfo: { __ref: pageInfoKey },
    });

    const ok = documents.hasDocument({
      document: operations.USER_POSTS_QUERY,
      variables: { id: "u1", postsCategory: "tech", postsFirst: 2, postsAfter: null },
    });

    expect(ok).toBe(false);
  });

  it("returns true when connection has edges with node data", () => {
    const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';

    writeConnectionPage(graph, pageKey, {
      __typename: "UserConnection",
      edges: [
        {
          __typename: "UserEdge",
          cursor: "u1",
          node: { __typename: "User", id: "u1", email: "u1@example.com" },
        },
        {
          __typename: "UserEdge",
          cursor: "u2",
          node: { __typename: "User", id: "u2", email: "u2@example.com" },
        },
      ],
      pageInfo: {
        startCursor: "u1",
        endCursor: "u2",
        hasNextPage: true,
        hasPreviousPage: false,
      },
    });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(true);
  });

  it("returns false when connection edges exist but node data is incomplete", () => {
    const pageKey = '@.users({"after":null,"first":2,"role":"admin"})';

    graph.putRecord(pageKey, {
      __typename: "UserConnection",
      edges: { __refs: [`${pageKey}.edges.0`] },
      pageInfo: { __ref: `${pageKey}.pageInfo` },
    });
    graph.putRecord(`${pageKey}.pageInfo`, {
      __typename: "PageInfo",
      startCursor: "u1",
      endCursor: "u1",
      hasNextPage: false,
      hasPreviousPage: false,
    });
    graph.putRecord(`${pageKey}.edges.0`, {
      __typename: "UserEdge",
      node: { __ref: "User:u1" },
      cursor: "u1",
    });
    graph.putRecord("User:u1", { __typename: "User", id: "u1" });

    const ok = documents.hasDocument({
      document: operations.USERS_QUERY,
      variables: { role: "admin", first: 2, after: null },
    });

    expect(ok).toBe(false);
  });

  describe("POSTS_WITH_AGGREGATIONS_QUERY", () => {
    it("returns false when root posts connection is missing", () => {
      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when root posts connection exists but missing totalCount", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      graph.putRecord(postsPageKey, {
        __typename: "PostConnection",
        edges: { __refs: [] },
        pageInfo: { __ref: `${postsPageKey}.pageInfo` },
      });
      graph.putRecord(`${postsPageKey}.pageInfo`, {
        __typename: "PageInfo",
        hasNextPage: false,
        hasPreviousPage: false,
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when root posts connection exists but missing aggregations", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when aggregations exist but missing scoring scalar", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when aggregations.todayStat is missing", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when aggregations.tags connection is missing", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, {
        __typename: "Stat",
        key: "today",
        views: 100,
      });
      graph.putRecord(yesterdayStatKey, {
        __typename: "Stat",
        key: "yesterday",
        views: 90,
      });
      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns true when all connection-level aggregations are present with empty edges", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 0,
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(ROOT_ID, {
        ['posts({"after":null,"category":"tech","first":10})']: { __ref: postsPageKey },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, {
        __typename: "Stat",
        key: "today",
        views: 100,
      });
      graph.putRecord(yesterdayStatKey, {
        __typename: "Stat",
        key: "yesterday",
        views: 90,
      });

      const baseTagsKey = '@.posts({"after":null,"category":"tech","first":10}).aggregations.tags({"first":50})';
      writeConnectionPage(graph, baseTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
        ['tags({"first":50})']: { __ref: baseTagsKey },
      });

      const existingPage = graph.getRecord(postsPageKey);
      graph.putRecord(postsPageKey, {
        ...existingPage,
        aggregations: { __ref: aggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(true);
    });

    it("returns false when post node exists but missing nested aggregations", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        edges: [
          {
            __typename: "PostEdge",
            cursor: "p1",
            node: {
              __typename: "VideoPost",
              id: "p1",
              title: "Video Title",
              flags: [],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, {
        __typename: "Stat",
        key: "today",
        views: 100,
      });
      graph.putRecord(yesterdayStatKey, {
        __typename: "Stat",
        key: "yesterday",
        views: 90,
      });

      const baseTagsKey = '@.posts({"after":null,"category":"tech","first":10}).aggregations.tags({"first":50})';
      writeConnectionPage(graph, baseTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
        ['tags({"first":50})']: { __ref: baseTagsKey },
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when post.aggregations exists but missing moderationTags connection", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        edges: [
          {
            __typename: "VideoPost",
            cursor: "p1",
            node: {
              __typename: "VideoPost",
              id: "p1",
              title: "Video Title",
              flags: [],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, {
        __typename: "Stat",
        key: "today",
        views: 100,
      });
      graph.putRecord(yesterdayStatKey, {
        __typename: "Stat",
        key: "yesterday",
        views: 90,
      });

      const baseTagsKey = '@.posts({"after":null,"category":"tech","first":10}).aggregations.tags({"first":50})';
      writeConnectionPage(graph, baseTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
        ['tags({"first":50})']: { __ref: baseTagsKey },
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const postAggKey = `VideoPost:p1.aggregations`;
      graph.putRecord(postAggKey, {
        __typename: "PostAggregations",
      });
      graph.putRecord("VideoPost:p1", {
        aggregations: { __ref: postAggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns false when VideoPost node exists but missing video field", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        edges: [
          {
            __typename: "PostEdge",
            cursor: "p1",
            node: {
              __typename: "VideoPost",
              id: "p1",
              title: "Video Title",
              flags: [],
            },
          },
        ],
        pageInfo: {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(ROOT_ID, {
        ['posts({"after":null,"category":"tech","first":10})']: { __ref: postsPageKey },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, { __typename: "Stat", key: "today", views: 100 });
      graph.putRecord(yesterdayStatKey, { __typename: "Stat", key: "yesterday", views: 90 });

      const baseTagsKey = '@.posts({"after":null,"category":"tech","first":10}).aggregations.tags({"first":50})';
      writeConnectionPage(graph, baseTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
        ['tags({"first":50})']: { __ref: baseTagsKey },
      });
      graph.putRecord(postsPageKey, { aggregations: { __ref: aggKey } });

      const postAggKey = `Post:p1.aggregations`;
      const modTagsKey = '@.Post:p1.aggregations.tags({"category":"moderation","first":25})';
      const userTagsKey = '@.Post:p1.aggregations.tags({"category":"user","first":25})';

      writeConnectionPage(graph, modTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      writeConnectionPage(graph, userTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(postAggKey, {
        __typename: "PostAggregations",
        ['tags({"category":"moderation","first":25})']: { __ref: modTagsKey },
        ['tags({"category":"user","first":25})']: { __ref: userTagsKey },
      });

      graph.putRecord("Post:p1", {
        __typename: "VideoPost",
        id: "p1",
        title: "Video Title",
        flags: [],
        aggregations: { __ref: postAggKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(false);
    });

    it("returns true when all fields present including VideoPost with video and nested connections", () => {
      const postsPageKey = '@.posts({"after":null,"category":"tech","first":10})';

      writeConnectionPage(graph, postsPageKey, {
        __typename: "PostConnection",
        totalCount: 1,
        edges: [
          {
            __typename: "PostEdge",
            cursor: "p1",
            node: {
              __typename: "VideoPost",
              id: "p1",
              title: "Video Title",
              flags: [],
            },
          },
        ],
        pageInfo: {
          startCursor: "p1",
          endCursor: "p1",
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(ROOT_ID, {
        ['posts({"after":null,"category":"tech","first":10})']: { __ref: postsPageKey },
      });

      const aggKey = `${postsPageKey}.aggregations`;
      const todayStatKey = `${aggKey}.stat({"key":"today"})`;
      const yesterdayStatKey = `${aggKey}.stat({"key":"yesterday"})`;

      graph.putRecord(todayStatKey, {
        __typename: "Stat",
        key: "today",
        views: 100,
      });
      graph.putRecord(yesterdayStatKey, {
        __typename: "Stat",
        key: "yesterday",
        views: 90,
      });

      const baseTagsKey = '@.posts({"after":null,"category":"tech","first":10}).aggregations.tags({"first":50})';
      writeConnectionPage(graph, baseTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(aggKey, {
        __typename: "PostAggregations",
        scoring: 42,
        ['stat({"key":"today"})']: { __ref: todayStatKey },
        ['stat({"key":"yesterday"})']: { __ref: yesterdayStatKey },
        ['tags({"first":50})']: { __ref: baseTagsKey },
      });
      graph.putRecord(postsPageKey, {
        aggregations: { __ref: aggKey },
      });

      const postAggKey = `Post:p1.aggregations`;
      const modTagsKey = '@.Post:p1.aggregations.tags({"category":"moderation","first":25})';
      const userTagsKey = '@.Post:p1.aggregations.tags({"category":"user","first":25})';

      writeConnectionPage(graph, modTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      writeConnectionPage(graph, userTagsKey, {
        __typename: "TagConnection",
        edges: [],
        pageInfo: {
          startCursor: null,
          endCursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });

      graph.putRecord(postAggKey, {
        __typename: "PostAggregations",
        ['tags({"category":"moderation","first":25})']: { __ref: modTagsKey },
        ['tags({"category":"user","first":25})']: { __ref: userTagsKey },
      });

      const videoKey = `Post:p1.video`;
      graph.putRecord(videoKey, {
        __typename: "Media",
        key: "video-123",
        mediaUrl: "https://example.com/video.mp4",
      });

      graph.putRecord("Post:p1", {
        __typename: "VideoPost",
        id: "p1",
        title: "Video Title",
        flags: [],
        aggregations: { __ref: postAggKey },
        video: { __ref: videoKey },
      });

      const ok = documents.hasDocument({
        document: operations.POSTS_WITH_AGGREGATIONS_QUERY,
        variables: { category: "tech", first: 10, after: null },
      });

      expect(ok).toBe(true);
    });
  });
});
