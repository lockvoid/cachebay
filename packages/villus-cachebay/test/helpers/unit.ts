import { visit, Kind, type DocumentNode } from "graphql";
import gql from "graphql-tag";
import type { PlanField } from "@/src/compiler";
import { compilePlan } from "@/src/compiler/compile";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";

export function readCanonicalEdges(graph: ReturnType<typeof createGraph>, canonicalKey: string) {
  const page = graph.getRecord(canonicalKey) || {};
  const refs = Array.isArray(page.edges) ? page.edges : [];
  const out: Array<{ edgeRef: string; nodeKey: string; meta: Record<string, any> }> = [];
  for (let i = 0; i < refs.length; i++) {
    const edgeRef = refs[i]?.__ref;
    if (!edgeRef) continue;
    const e = graph.getRecord(edgeRef) || {};
    out.push({
      edgeRef,
      nodeKey: e?.node?.__ref,
      meta: Object.fromEntries(
        Object.keys(e || {})
          .filter((k) => k !== "cursor" && k !== "node" && k !== "__typename")
          .map((k) => [k, e[k]])
      ),
    });
  }
  return out;
}

const stableStringify = (obj: any) => {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
};

export const createPlanField = (
  name: string,
  isConnection = false,
  children: PlanField[] | null = null
): PlanField => {
  const map = new Map<string, PlanField>();
  if (children) {
    for (let i = 0; i < children.length; i++) {
      map.set(children[i].responseKey, children[i]);
    }
  }
  return {
    responseKey: name,
    fieldName: name,
    isConnection,
    buildArgs: () => ({}),
    stringifyArgs: () => stableStringify({}),
    selectionSet: children,
    selectionMap: children ? map : undefined,
  };
};

export const createConnectionPlanField = (name: string): PlanField => {
  // connection needs edges.node at minimum
  const node = createPlanField("node", false, [createPlanField("id"), createPlanField("__typename")]);
  const edges = createPlanField("edges", false, [createPlanField("__typename"), createPlanField("cursor"), node]);
  return createPlanField(name, true, [createPlanField("__typename"), createPlanField("pageInfo"), edges]);
};

/** Seed a connection page and its edge records */
export const seedConnectionPage = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  edges: Array<{ nodeRef: string; cursor?: string; extra?: Record<string, any> }>,
  pageInfo?: Record<string, any>,
  extra?: Record<string, any>,
  edgeTypename = "Edge",
  connectionTypename = "Connection"
) => {
  const edgeRefs: Array<{ __ref: string }> = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    graph.putRecord(edgeKey, {
      __typename: edgeTypename,
      cursor: e.cursor ?? null,
      ...(e.extra || {}),
      node: { __ref: e.nodeRef },
    });
    edgeRefs.push({ __ref: edgeKey });
  }

  const snap: Record<string, any> = { __typename: connectionTypename, edges: edgeRefs };
  if (pageInfo) snap.pageInfo = { ...(pageInfo as any) };
  if (extra) Object.assign(snap, extra);

  graph.putRecord(pageKey, snap);
};

export const writePageSnapshot = (
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: number[],
  pageInfo?: { start?: string; end?: string; hasNext?: boolean; hasPrev?: boolean }
) => {
  const edgeRefs: Array<{ __ref: string }> = [];

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i];
    const edgeKey = `${pageKey}.edges.${i}`;
    const cursor = `p${nodeId}`;

    graph.putRecord(`Post:${nodeId}`, {
      __typename: "Post",
      id: String(nodeId),
      title: `Post ${nodeId}`,
      tags: [],
    });

    graph.putRecord(edgeKey, {
      __typename: "PostEdge",
      cursor,
      node: { __ref: `Post:${nodeId}` },
    });

    edgeRefs.push({ __ref: edgeKey });
  }

  const page = {
    __typename: "PostConnection",
    pageInfo: {
      __typename: "PageInfo",
      startCursor: pageInfo?.start || `p${nodeIds[0]}`,
      endCursor: pageInfo?.end || `p${nodeIds[nodeIds.length - 1]}`,
      hasNextPage: pageInfo?.hasNext ?? false,
      hasPreviousPage: pageInfo?.hasPrev ?? false,
    },
    edges: edgeRefs,
  };

  graph.putRecord(pageKey, page);

  return { page, edgeRefs };
};

export const collectConnectionDirectives = (doc: DocumentNode): string[] => {
  const hits: string[] = [];
  visit(doc, {
    Field(node) {
      const hasConn = (node.directives || []).some(d => d.name.value === "connection");
      if (hasConn) hits.push(node.name.value);
    }
  });
  return hits;
};

export const selectionSetHasTypename = (node: any): boolean => {
  const ss = node?.selectionSet;
  if (!ss || !Array.isArray(ss.selections)) return false;
  return ss.selections.some((s: any) => s.kind === Kind.FIELD && s.name?.value === "__typename");
};

export const hasTypenames = (doc: DocumentNode): boolean => {
  let ok = true;
  visit(doc, {
    SelectionSet(node) {
      if (!selectionSetHasTypename({ selectionSet: node })) ok = false;
    }
  });
  return ok;
};


// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Fragments
// ─────────────────────────────────────────────────────────────────────────────

export const USER_FRAGMENT = gql`
  fragment UserFields on User {
    id
    email
  }
`;

export const POST_FRAGMENT = gql`
  fragment PostFields on Post {
    id
    title
    tags
  }
`;

export const COMMENT_FRAGMENT = gql`
  fragment CommentFields on Comment {
    id
    text
  }
`;

export const USER_POSTS_FRAGMENT = gql`
  fragment UserPosts on User {
    id
    email
    posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
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
        score
        node {
          __typename
          id
          title
          tags
        }
      }
    }
  }
`;

export const POST_COMMENTS_FRAGMENT = gql`
  fragment PostWithComments on Post {
    id
    title
    comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
      __typename
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
          text
          author {
            __typename
            id
          }
        }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Queries
// ─────────────────────────────────────────────────────────────────────────────

export const USER_QUERY = gql`
  ${USER_FRAGMENT}

  query UserQuery($id: ID!) {
    user(id: $id) {

      ...UserFields
    }
  }
`;

export const USERS_QUERY = gql`
  ${USER_FRAGMENT}

  query UsersQuery($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) @connection(args: ["role"]) {

      pageInfo {
                startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
                cursor

        node {

          ...UserFields
        }
      }
    }
  }
`;

export const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    user(id: $id) {

      ...UserFields

      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {

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

            ...PostFields

            author {

              id
            }
          }
        }
      }
    }
  }
`;

export const UPDATE_USER_MUTATION = gql`
  ${USER_FRAGMENT}

  mutation UpdateUserMutation($input: UpdateUserInput!, $postCategory: String!, $postFirst: Int!, $postAfter: String!) {
    updateUser(id: $id, input: $input) {

      user {

        ...UserFields

        name

        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {

          pageInfo {
                        startCursor
            endCursor
            hasNextPage
            hasPreviousPage
          }

          edges {
                        cursor

            node {

              ...PostFields
            }
          }
        }
      }
    }
  }
`;

export const USER_UPDATED_SUBSCRIPTION = gql`
  ${USER_FRAGMENT}
  subscription UserUpdatedSubscription($id: ID!) {
    userUpdated(id: $id) {
      user {

        ...UserFields

        name
      }
    }
  }
`;

export const USERS_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}

  query UsersPostsQuery(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {

      pageInfo {
                startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
                cursor
        node {

          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {

            pageInfo {
                            startCursor
              endCursor
              hasNextPage
              hasPreviousPage
            }

            edges {
                            cursor

              node {

                ...PostFields
              }
            }
          }
        }
      }
    }
  }
`;

export const USER_POSTS_COMMENTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${COMMENT_FRAGMENT}

  query UserPostsCommentsQuery(
    $id: ID!
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    user(id: $id) {

      ...UserFields

      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {

        pageInfo {
                    startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }

        edges {
                    cursor
          node {

            ...PostFields

            comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {

              pageInfo {
                                startCursor
                endCursor
                hasNextPage
                hasPreviousPage
              }

              edges {
                                cursor

                node {

                  ...CommentFields

                  author {
                                        id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const USERS_POSTS_COMMENTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${COMMENT_FRAGMENT}

  query UsersPostsCommentsQuery(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {

      pageInfo {
                startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }

      edges {
                cursor

        node {

          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {

            pageInfo {
                            startCursor
              endCursor
              hasNextPage
              hasPreviousPage
            }

            edges {
                            cursor

              node {

                ...PostFields

                comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {

                  pageInfo {
                                        startCursor
                    endCursor
                    hasNextPage
                    hasPreviousPage
                  }

                  edges {
                                        cursor

                    node {
                                            ...CommentFields
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// NEW: Page-mode versions (for replacement canonical behavior)
export const USERS_PAGE_QUERY = gql`
  query UsersPage($usersRole: String, $first: Int, $after: String, $before: String, $last: Int) {
    users(role: $usersRole, first: $first, after: $after, before: $before, last: $last)
      @connection(args: ["role"], mode: "page") {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node { id email } }
    }
  }
`;

export const COMMENTS_PAGE_QUERY = gql`
  query CommentsPage($postId: ID!, $first: Int, $after: String, $before: String, $last: Int) {
    post(id: $postId) {
            id
      comments(first: $first, after: $after, before: $before, last: $last) @connection(args: [], mode: "page") {
                pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor node { id text } }
      }
    }
  }
`;

export const TEST_QUERIES = {
  USER_SIMPLE: gql`
    query UserQuery($id: ID!) {
      user(id: $id) {
        id
        email
      }
    }
  `,
  USERS_SIMPLE: gql`
    query UsersQuery($usersRole: String, $usersFirst: Int, $usersAfter: String) {
      users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
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
            email
          }
        }
      }
    }
  `,
  USER_USERS_MULTIPLE_QUERY: gql`
    query Mixed($id: ID!, $usersRole: String, $usersFirst: Int, $usersAfter: String) {
      user(id: $id) {
        id
        email
      }
      users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges { cursor node { id } }
      }
    }
  `,
  POSTS_WITH_CONNECTION: gql`
    query Q($postsCategory: String, $postsFirst: Int, $postsAfter: String) {
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
        @connection(filters: ["category"]) {
        edges { cursor node { id __typename } __typename }
        pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  `,
  POSTS_SIMPLE: gql`
    query Q($first: Int, $after: String) {
      posts(first: $first, after: $after) @connection {
        edges { cursor node { id __typename } __typename }
        pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  `,
  USER_POSTS_NESTED: gql`
    query Q($id: ID!, $first: Int, $after: String) {
      user(id: $id) {
        __typename id
        posts(first: $first, after: $after) @connection {
          edges { cursor node { id __typename } __typename }
          pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
        }
      }
    }
  `,
  POSTS_WITH_KEY: gql`
    query Q($cat: String, $first: Int, $after: String) {
      posts(category: $cat, first: $first, after: $after)
        @connection(key: "PostsList", filters: ["category"]) {
        edges { cursor node { id __typename } __typename }
        pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  `,
  POSTS_WITH_FILTERS: gql`
    query Q($category: String, $sort: String, $first: Int, $after: String) {
      posts(category: $category, sort: $sort, first: $first, after: $after)
        @connection {
        edges { cursor node { id __typename } __typename }
        pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  `,
} as const;

export const POSTS_QUERY = gql`
  query Posts($first: Int, $after: String) {
    posts(first: $first, after: $after) @connection(args: []) {
      __typename
      pageInfo { __typename startCursor endCursor hasNextPage hasPreviousPage }
      edges { __typename cursor node { __typename id title } }
    }
  }
`;

// Compiler-specific versions (to avoid conflicts with existing queries)
export const USERS_QUERY_COMPILER = gql`
  ${USER_FRAGMENT}
  query UsersQuery($usersRole: String, $usersFirst: Int, $usersAfter: String) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter)
      @connection(filters: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node { ...UserFields }
      }
    }
  }
`;

export const USER_POSTS_QUERY_COMPILER = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    user(id: $id) {
      ...UserFields
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
        @connection(filters: ["category"]) {
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
          cursor
          node {
            ...PostFields
            author { id }
          }
        }
      }
    }
  }
`;

export const USERS_POSTS_COMMENTS_QUERY_COMPILER = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${COMMENT_FRAGMENT}
  query UsersPostsCommentsQuery(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
    $commentsFirst: Int
    $commentsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter)
      @connection(filters: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter)
            @connection(filters: ["category"]) {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
              cursor
              node {
                ...PostFields
                comments(first: $commentsFirst, after: $commentsAfter)
                  @connection(filters: []) {
                  pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
                  edges { cursor node { ...CommentFields } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Extra queries for compiler tests
export const ALIAS_QUERY = gql`
  query AliasQuery($id: ID!) {
    currentUser: user(id: $id) { id email }
  }
`;

export const MULTI_TYPE_FRAGMENT_QUERY = gql`
  fragment UserOnly on User { id }
  fragment AdminOnly on Admin { role }

  query MixedTypes($id: ID!) {
    user(id: $id) {
      ...UserOnly
      ...AdminOnly
    }
  }
`;

// Connection-specific queries and fragments (to avoid conflicts)
export const POSTS_PAGE_CONNECTION_QUERY = gql`
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

export const POSTS_DEFAULT_CONNECTION_QUERY = gql`
  query UserList($category: String, $sort: String, $first: Int, $after: String) {
    posts(category: $category, sort: $sort, first: $first, after: $after) @connection {
      edges { cursor node { id } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const USERS_NO_CONNECTION_QUERY = gql`
  query HeuristicLike {
    users {
      edges { cursor node { id } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const POSTS_EXPLICIT_KEY_QUERY = gql`
  query UserList($category: String, $first: Int, $after: String) {
    posts(category: $category, first: $first, after: $after)
      @connection(key: "ProjectsList", args: ["category"]) {
      edges { cursor node { id } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const POSTS_FIELD_KEY_QUERY = gql`
  query UserList($category: String, $first: Int, $after: String) {
    posts(category: $category, first: $first, after: $after)
      @connection(args: ["category"]) {
      edges { cursor node { id } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const POST_COMMENTS_FRAGMENT_COMPILER = gql`
  fragment PostComments on Post {
    id
    comments(first: $first, after: $after)
      @connection(key: "PostComments", args: []) {
      edges { cursor node { id } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

export const USER_POSTS_FRAGMENT_COMPILER = gql`
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

export const USER_FEED_FRAGMENT_COMPILER = gql`
  fragment UserFeed on User {
    feed(first: $first) @connection(key: "Feed") {
      edges { cursor node { id } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export const USER_FIELDS_FRAGMENT_COMPILER = gql`
  fragment UserFields on User {
    id
    email
  }
`;

export const POSTS_SELECTION_MAPS_QUERY = gql`
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

export const createTestPlan = (query: DocumentNode) => {
  return compilePlan(query);
};

export const USERS_POSTS_QUERY_PLUGIN = gql`
  query UsersPosts(
    $usersRole: String
    $usersFirst: Int
    $usersAfter: String
    $postsCategory: String
    $postsFirst: Int
    $postsAfter: String
  ) {
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(args: ["role"]) {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
        cursor
        node {
          id
          email
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges { cursor node { id title } }
          }
        }
      }
    }
  }
`;

export const USER_QUERY_PLUGIN = gql`
  query User($id: ID!) {
    user(id: $id) { id email }
  }
`;

export const USERS_PAGE_QUERY_PLUGIN = gql`
  query UsersPage($usersRole: String, $first: Int, $after: String) {
    users(role: $usersRole, first: $first, after: $after) @connection(args: ["role"], mode: "page") {
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges { cursor node { id email } }
    }
  }
`;
