import { visit, Kind, type DocumentNode } from "graphql";
import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler/compile";
import { ROOT_ID } from "@/src/core/constants";
import { createGraph } from "@/src/core/graph";

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

export const everySelectionSetHasTypename = (doc: DocumentNode): boolean => {
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

export const createTestPlan = (query: DocumentNode) => {
  return compilePlan(query);
};

export function writePageSnapshot(
  graph: ReturnType<typeof createGraph>,
  pageKey: string,
  nodeIds: (number | string)[],
  opts?: { start?: string | null; end?: string | null; hasNext?: boolean; hasPrev?: boolean }
) {
  const pageInfo = {
    __typename: "PageInfo",
    startCursor: opts?.start ?? (nodeIds.length ? `p${nodeIds[0]}` : null),
    endCursor: opts?.end ?? (nodeIds.length ? `p${nodeIds[nodeIds.length - 1]}` : null),
    hasNextPage: !!opts?.hasNext,
    hasPreviousPage: !!opts?.hasPrev,
  };
  const edges = nodeIds.map((id, i) => {
    const edgeKey = `${pageKey}.edges.${i}`;
    const nodeKey = `Post:${id}`;
    graph.putRecord(nodeKey, { __typename: "Post", id: String(id), title: `Post ${id}`, tags: [] });
    graph.putRecord(edgeKey, { __typename: "PostEdge", cursor: `p${id}`, node: { __ref: nodeKey } });
    return { __ref: edgeKey };
  });
  graph.putRecord(pageKey, { __typename: "PostConnection", pageInfo, edges });
}
