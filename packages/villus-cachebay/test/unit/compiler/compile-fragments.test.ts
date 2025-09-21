// test/unit/compiler/compile-fragments.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler";
import {
  collectConnectionDirectives,
  everySelectionSetHasTypename,
} from "@/test/helpers";

describe("compiler: compileToPlan (fragments)", () => {
  it("compiles a simple User fragment (no args) with selectionMap", () => {
    const FRAG = gql`
      fragment UserFields on User {
        id
        email
      }
    `;

    const plan = compileToPlan(FRAG);

    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");
    expect(Array.isArray(plan.root)).toBe(true);

    const by = plan.rootSelectionMap!;
    expect(by.get("id")?.fieldName).toBe("id");
    expect(by.get("email")?.fieldName).toBe("email");

    // Network doc: no @connection and __typename is materialized everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("compiles a fragment with a connection using @connection; builds selectionMap on nested sets", () => {
    const FRAG = gql`
      fragment UserPosts on User {
        id
        posts(category: $cat, first: $first, after: $after)
          @connection(filters: ["category"], mode: "infinite") {
          totalCount
          pageInfo {
            startCursor
            endCursor
            hasNextPage
            hasPreviousPage
          }
          edges {
            cursor
            score
            node {
              id
              title
            }
          }
        }
      }
    `;

    const plan = compileToPlan(FRAG);

    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");

    const rootBy = plan.rootSelectionMap!;
    const posts = rootBy.get("posts")!;
    expect(posts.isConnection).toBe(true);
    // default connection key falls back to the field name when not provided
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    // nested selection maps exist
    const edgesField = posts.selectionMap!.get("edges")!;
    const nodeField = edgesField.selectionMap!.get("node")!;
    expect(nodeField.fieldName).toBe("node");

    // stringifyArgs gets raw vars and applies buildArgs internally (uses field arg names)
    const key = `${posts.fieldName}(${posts.stringifyArgs({ cat: "tech", first: 2, after: null })})`;
    expect(key).toBe('posts({"after":null,"category":"tech","first":2})');

    // Network doc: no @connection and __typename is materialized everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("throws when doc has neither op nor exactly one fragment", () => {
    const DOC = gql`
      fragment A on User { id }
      fragment B on User { email }
    `;
    expect(() => compileToPlan(DOC)).toThrowError();
  });

  it("fragment with explicit @connection(key: ...) captures the key", () => {
    const FRAG = gql`
      fragment UserFeed on User {
        feed(first: $first) @connection(key: "Feed") {
          edges { cursor node { id } }
          pageInfo { endCursor hasNextPage }
        }
      }
    `;
    const plan = compileToPlan(FRAG);
    const feed = plan.rootSelectionMap!.get("feed")!;
    expect(feed.isConnection).toBe(true);
    expect(feed.connectionKey).toBe("Feed");
    expect(feed.connectionFilters).toEqual([]); // default
    expect(feed.connectionMode).toBe("infinite");  // default

    // Network doc: no @connection and __typename is materialized everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });
});
