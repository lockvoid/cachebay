import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler";

describe("compiler: @connection directive (explicit-only)", () => {
  it("marks connection only when @connection is present; attaches mode and args", () => {
    const DOC = gql`
      query UserList($category: String, $first: Int, $after: String) {
        posts(category: $category, first: $first, after: $after)
          @connection(mode: "page", args: ["category"]) {
          __typename
          totalCount
          pageInfo {
            __typename
            startCursor
            endCursor
            hasNextPage
            hasPreviousPage
          }
          edges {
            __typename
            cursor
            node {
              __typename
              id
              title
            }
          }
        }
      }
    `;

    const plan = compileToPlan(DOC);
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("page");
    expect(posts.connectionArgs).toEqual(["category"]);

    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    // stringifyArgs uses RAW vars
    const keyStr = posts.stringifyArgs({ category: "tech", first: 10, after: null });
    expect(keyStr).toBe('{"after":null,"category":"tech","first":10}');
  });

  it("defaults mode to 'infinite' and args to all non-pagination args when omitted", () => {
    const DOC = gql`
      query UserList($category: String, $sort: String, $first: Int, $after: String) {
        posts(category: $category, sort: $sort, first: $first, after: $after)
          @connection {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compileToPlan(DOC);
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionMode).toBe("infinite");
    // $category and $sort are identity args; pagination args excluded
    expect(posts.connectionArgs!.sort()).toEqual(["category", "sort"]);
  });

  it("does NOT mark as connection when directive is absent (no heuristic)", () => {
    const DOC = gql`
      query HeuristicLike {
        users {
          __typename
          edges { cursor node { __typename id } }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;
    const plan = compileToPlan(DOC);
    const users = plan.rootSelectionMap!.get("users")!;
    expect(users.isConnection).toBe(false);
    expect(users.connectionMode).toBeUndefined();
    expect(users.connectionArgs).toBeUndefined();
  });

  it("works inside a fragment", () => {
    const FRAG = gql`
      fragment PostComments on Post {
        id
        comments(first: $first, after: $after) @connection(args: []) {
          __typename
          edges { __typename cursor node { __typename id } }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    `;

    const plan = compileToPlan(FRAG);
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("Post");

    const comments = plan.rootSelectionMap!.get("comments")!;
    expect(comments.isConnection).toBe(true);
    expect(comments.connectionMode).toBe("infinite"); // default mode
    expect(comments.connectionArgs).toEqual([]);      // explicit empty list
  });
});
