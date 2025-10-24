import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, hasTypenames, operations } from "@/test/helpers";

describe("Compiler x Fragments", () => {
  it("compiles a simple User fragment (no args) with selectionMap", () => {
    const plan = compilePlan(operations.USER_FRAGMENT);

    expect(plan.kind).toBe("CachePlan");
    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");
    expect(Array.isArray(plan.root)).toBe(true);

    const user = plan.rootSelectionMap!;
    expect(user.get("id")?.fieldName).toBe("id");
    expect(user.get("email")?.fieldName).toBe("email");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("includes __typename in fragment root selection (plan.root) for cache reads", () => {
    // Fragment without explicit __typename in source
    const FRAGMENT = gql`
      fragment UserFields on User {
        id
        email
      }
    `;

    const plan = compilePlan(FRAGMENT);

    const typenameField = plan.root.find(f => f.fieldName === "__typename");
    expect(typenameField).toBeDefined();
    expect(typenameField?.responseKey).toBe("__typename");

    // Also verify it's in the selection map
    expect(plan.rootSelectionMap!.has("__typename")).toBe(true);

    // And in the network query
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("includes __typename in pageInfo selection for connections", () => {
    // Fragment with connection using fragment spread for pageInfo
    const FRAGMENT = gql`
      fragment PageInfoFields on PageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      
      fragment UserPosts on User {
        posts(first: $first) @connection {
          pageInfo {
            ...PageInfoFields
          }
          edges {
            cursor
            node { id }
          }
        }
      }
    `;

    const plan = compilePlan(FRAGMENT, { fragmentName: "UserPosts" });
    
    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    
    const pageInfo = posts.selectionMap!.get("pageInfo")!;
    expect(pageInfo).toBeDefined();
    
    expect(pageInfo.selectionMap!.has("__typename")).toBe(true);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("includes __typename in pageInfo and edges for connection fields", () => {
    // Fragment with connection but no explicit __typename in pageInfo
    const FRAGMENT = gql`
      fragment UserPostsWithFilters on User {
        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(filters: ["category"]) {
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

    const plan = compilePlan(FRAGMENT, { fragmentName: "UserPostsWithFilters" });

    expect(plan.root.find(f => f.fieldName === "__typename")).toBeDefined();

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);

    const pageInfo = posts.selectionMap!.get("pageInfo")!;
    expect(pageInfo).toBeDefined();
    const pageInfoTypename = pageInfo.selectionSet?.find(f => f.fieldName === "__typename");
    expect(pageInfoTypename).toBeDefined();
    expect(pageInfoTypename?.responseKey).toBe("__typename");

    const edges = posts.selectionMap!.get("edges")!;
    expect(edges).toBeDefined();
    const edgesTypename = edges.selectionSet?.find(f => f.fieldName === "__typename");
    expect(edgesTypename).toBeDefined();

    const node = edges.selectionMap!.get("node")!;
    expect(node).toBeDefined();
    const nodeTypename = node.selectionSet?.find(f => f.fieldName === "__typename");
    expect(nodeTypename).toBeDefined();

    // Verify network query has typenames everywhere
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("compiles a fragment with a connection using @connection; builds selectionMap on nested sets", () => {
    const plan = compilePlan(operations.USER_POSTS_FRAGMENT, { fragmentName: "UserPosts" });

    expect(plan.operation).toBe("fragment");
    expect(plan.rootTypename).toBe("User");

    const posts = plan.rootSelectionMap!.get("posts")!;
    expect(posts.isConnection).toBe(true);
    expect(posts.connectionKey).toBe("posts");
    expect(posts.connectionFilters).toEqual(["category"]);
    expect(posts.connectionMode).toBe("infinite");

    const edges = posts.selectionMap!.get("edges")!;
    const node = edges.selectionMap!.get("node")!;
    expect(node.fieldName).toBe("node");

    const postsKey = `${posts.fieldName}(${posts.stringifyArgs({ postsCategory: "tech", postsFirst: 2, postsAfter: null })})`;
    expect(postsKey).toBe('posts({"category":"tech","first":2,"after":null})');

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("throws when doc has neither op nor exactly one fragment", () => {
    const DOC = gql`
      fragment A on User { id }
      fragment B on User { email }
    `;

    expect(() => compilePlan(DOC)).toThrowError();
  });

  it("fragment with explicit @connection(key: ...) captures the key", () => {
    const plan = compilePlan(operations.USER_POSTS_WITH_KEY_FRAGMENT, { fragmentName: "UserPosts" });

    const feed = plan.rootSelectionMap!.get("posts")!;
    expect(feed.isConnection).toBe(true);
    expect(feed.connectionKey).toBe("UserPosts");
    expect(feed.connectionFilters).toEqual(["category"]);
    expect(feed.connectionMode).toBe("infinite");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });
});
