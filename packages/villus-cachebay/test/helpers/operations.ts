import gql from 'graphql-tag';

/* ──────────────────────────────────────────────────────────────────────────
 * Fragments
 * ------------------------------------------------------------------------ */
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

export const AUDIO_POST_FRAGMENT = gql`
  fragment AudioPostFields on AudioPost {
    id
    title
    tags
  }
`;

export const VIDEO_POST_FRAGMENT = gql`
  fragment VideoPostFields on VideoPost {
    id
    title
    tags
  }
`;

export const COMMENT_FRAGMENT = gql`
  fragment CommentFields on Comment {
    uuid
    text
  }
`;

/* ──────────────────────────────────────────────────────────────────────────
 * Queries (use @connection)
 * ------------------------------------------------------------------------ */
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

/** Root posts connection (used by error-handling & cache-policy tests). */
export const POSTS_QUERY = gql`
  ${POST_FRAGMENT}
  query Posts($filter: String, $first: Int, $after: String) {
    posts(filter: $filter, first: $first, after: $after) @connection(args: ["filter"]) {
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
`;

export const USER_POSTS_QUERY = gql`
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${AUDIO_POST_FRAGMENT}
  ${VIDEO_POST_FRAGMENT}
  query UserPostsQuery($id: ID!, $postsCategory: String, $postsFirst: Int, $postsAfter: String) {
    user(id: $id) {
            ...UserFields
      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
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
                        ...PostFields
            ...AudioPostFields
            ...VideoPostFields
            author { id }
          }
        }
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
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
                cursor
        node {
                    ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
                        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
                            cursor
              node { ...PostFields }
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
                pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
        edges {
                    cursor
          node {
                        ...PostFields
            comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
                            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
              edges {
                                cursor
                node {
                                    ...CommentFields
                  author { id }
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
            pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      edges {
                cursor
        node {
                    ...UserFields
          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
                        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
            edges {
                            cursor
              node {
                                ...PostFields
                comments(first: $commentsFirst, after: $commentsAfter) @connection(args: []) {
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
