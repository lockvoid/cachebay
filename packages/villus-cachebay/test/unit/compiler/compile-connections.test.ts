// test/unit/compiler/compile-connections.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, selectionSetHasTypename, everySelectionSetHasTypename } from '@/test/helpers';

describe("compiler: @connection directive (explicit-only)", () => {
  it("marks connection only when @connection is present; attaches mode and args", () => {
    const DOC = gql`
      query UserList($postsCategory: String, $postsFirst: Int, $postsAfter: String) {
        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
          @connection(mode: "page", args: ["category"]) {
          totalCount
          pageInfo {
            startCursor
            endCursor
            hasNextPage
            hasPreviousPage
          }
          edges {
            cursor
            node {
              id
              title
            }
          }
        }
      }
    `;

    const plan = compilePlan(DOC);
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("page");
    expect(posts.connectionFilters).toEqual(["category"]);

    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    // stringifyArgs maps RAW variable names -> FIELD ARG names
    const keyStr = posts.stringifyArgs({
      postsCategory: "tech",
      postsFirst: 10,
      postsAfter: null,
    });
    expect(keyStr).toBe('{"after":null,"category":"tech","first":10}');

    // Network doc: no @connection directives, __typename added everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("defaults mode to 'infinite' and args to all non-pagination args when omitted", () => {
    const DOC = gql`
      query UserList($category: String, $sort: String, $first: Int, $after: String) {
        posts(category: $category, sort: $sort, first: $first, after: $after) @connection {
          edges { cursor node { id } }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compilePlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("infinite");
    // $category and $sort are identity args; pagination args excluded
    expect(posts.connectionFilters!.sort()).toEqual(["category", "sort"]);

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("does NOT mark as connection when directive is absent (no heuristic)", () => {
    const DOC = gql`
      query HeuristicLike {
        users {
          edges { cursor node { id } }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compilePlan(DOC);
    const users = plan.rootSelectionMap!.get("users")!;
    expect(users.isConnection).toBe(false);
    expect(users.connectionMode).toBeUndefined();
    expect(users.connectionFilters).toBeUndefined();

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("uses explicit key when provided", () => {
    const DOC = gql`
      query UserList($category: String, $first: Int, $after: String) {
        posts(category: $category, first: $first, after: $after)
          @connection(key: "ProjectsList", args: ["category"]) {
          edges { cursor node { id } }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compilePlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("ProjectsList");
    expect(posts.connectionFilters).toEqual(["category"]);

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("falls back to field name as key when key is omitted", () => {
    const DOC = gql`
      query UserList($category: String, $first: Int, $after: String) {
        posts(category: $category, first: $first, after: $after)
          @connection(args: ["category"]) {
          edges { cursor node { id } }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compilePlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    // default key = fieldName
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("key + args also work inside a fragment", () => {
    const FRAG = gql`
      fragment PostComments on Post {
        id
        comments(first: $first, after: $after)
          @connection(key: "PostComments", args: []) {
          edges { cursor node { id } }
          pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compilePlan(FRAG);
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("Post");

    const comments = plan.rootSelectionMap!.get("comments")!;
    expect(comments.isConnection).toBe(true);
    expect(comments.connectionKey).toBe("PostComments");
    expect(comments.connectionFilters).toEqual([]); // explicit empty
    expect(comments.connectionMode).toBe("infinite"); // default mode

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("builds selection maps for pageInfo and edges shape reliably", () => {
    const DOC = gql`
      query Q($category: String, $first: Int, $after: String) {
        posts(category: $category, first: $first, after: $after)
          @connection(args: ["category"]) {
          pageInfo {
            startCursor
            endCursor
            hasNextPage
            hasPreviousPage
          }
          edges {
            cursor
            node {
              id
              title
            }
          }
        }
      }
    `;

    const plan = compilePlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);

    const pageInfo = posts.selectionMap!.get("pageInfo")!;
    expect(pageInfo.responseKey).toBe("pageInfo");
    expect(Array.isArray(pageInfo.selectionSet)).toBe(true);

    const edges = posts.selectionMap!.get("edges")!;
    expect(edges.responseKey).toBe("edges");
    const node = edges.selectionMap!.get("node")!;
    expect(Array.isArray(node.selectionSet)).toBe(true);

    // Network doc assertions
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });
});
