import { gql } from 'graphql-tag';

export const PAGE_INFO_FRAGMENT = `
  fragment PageInfoFields on PageInfo {
    startCursor
    endCursor
    hasNextPage
    hasPreviousPage
  }
`

export const USER_FRAGMENT = `
  fragment UserFields on User {
    id
    email
  }
`;

export const POST_FRAGMENT = `
  fragment PostFields on Post {
    id
    title
    tags
  }
`;

export const AUDIO_POST_FRAGMENT = `
  fragment AudioPostFields on AudioPost {
    id
    title
    tags
  }
`;

export const VIDEO_POST_FRAGMENT = `
  fragment VideoPostFields on VideoPost {
    id
    title
    tags
  }
`;

export const COMMENT_FRAGMENT = `
  fragment CommentFields on Comment {
    uuid
    text
  }
`;

export const USER_POSTS_FRAGMENT = `
  ${PAGE_INFO_FRAGMENT}
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}

  fragment UserPosts on User {
    ...UserFields

    posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(args: ["category"]) {
      totalCount

      pageInfo {
      ...PageInfoFields
      }

      edges {
        cursor
        score

        node {
          ...PostFields
        }
      }
    }
  }
`;

export const USER_POSTS_WITH_KEY_FRAGMENT = `
  ${PAGE_INFO_FRAGMENT}
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}

  fragment UserPosts on User {
    ...UserFields

    posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(key: "UserPosts", args: ["category"]) {
      totalCount

      pageInfo {
      ...PageInfoFields
      }

      edges {
        cursor
        score

        node {
          ...PostFields
        }
      }
    }
  }
`;

export const POST_COMMENTS_FRAGMENT = `
  ${PAGE_INFO_FRAGMENT}

  fragment PostComments on Post {
    id

    comments(first: $commentsFirst, after: $commentsAfter) @connection(key: "PostComments") {
      pageInfo {
        ...PageInfoFields
      }

      edges {
        cursor

        node {
          id
        }
      }
    }
  }
`;

export const MULTIPLE_USER_FRAGMENT = gql`
  fragment UserOnly on User {
    id
  }

  fragment AdminOnly on Admin {
    role
  }

  query MixedTypes($id: ID!) {
    user(id: $id) {
      ...UserOnly
      ...AdminOnly
    }
  }
`;

export const USER_QUERY = gql`
  ${USER_FRAGMENT}

  query UserQuery($id: ID!) {
    user(id: $id) {
      ...UserFields
    }
  }
`;

export const USER_WITH_ALIAS_QUERY = gql`
  ${USER_FRAGMENT}

  query UserWithAliasQuery($id: ID!) {
    currentUser: user(id: $id) {
      ...UserFields
    }
  }
`;

export const USERS_QUERY = gql`
  ${PAGE_INFO_FRAGMENT}
  ${USER_FRAGMENT}

  query UsersQuery($role: String, $first: Int, $after: String, $last: Int, $before: String) {
    users(role: $role, first: $first, after: $after, last: $last, before: $before) @connection(filters: ["role"]) {
      pageInfo {
        ...PageInfoFields
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

export const POSTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${POST_FRAGMENT}

  query Posts($category: String, $sort: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(category: $category, sort: $sort, first: $first, after: $after, last: $last, before: $before) @connection(filters: ["category", "sort"]) {
      pageInfo {
        ...PageInfoFields
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

export const POSTS_WITHOUT_CONNECTION_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${POST_FRAGMENT}

  query Posts($category: String, $sort: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(category: $category, sort: $sort, first: $first, after: $after, last: $last, before: $before) {
      pageInfo {
        ...PageInfoFields
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

export const POSTS_WITH_DEFAULTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${POST_FRAGMENT}

  query Posts($category: String, $sort: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(category: $category, sort: $sort, first: $first, after: $after, last: $last, before: $before) @connection {
      pageInfo {
        ...PageInfoFields
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

export const POSTS_WITH_KEY_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${POST_FRAGMENT}

  query Posts($category: String, $sort: String, $first: Int, $after: String, $last: Int, $before: String) {
    posts(category: $category, sort: $sort, first: $first, after: $after, last: $last, before: $before) @connection(filters: ["category", "sort"], key: "KeyedPosts") {
      pageInfo {
        ...PageInfoFields
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

export const USER_POSTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${USER_FRAGMENT}
  ${POST_FRAGMENT}
  ${AUDIO_POST_FRAGMENT}
  ${VIDEO_POST_FRAGMENT}

  query UserPostsQuery($id: ID!, $postsCategory: String, $postsSort: String, $postsFirst: Int, $postsAfter: String, $postsLast: Int, $postsBefore: String) {
    user(id: $id) {
      ...UserFields

      posts(category: $postsCategory, sort: $postsSort, first: $postsFirst, after: $postsAfter, last: $postsLast, before: $postsBefore) @connection(filters: ["category", "sort"]) {
        totalCount

        pageInfo {
          ...PageInfoFields
        }

        edges {
          cursor
          score

          node {
            ...PostFields
            ...AudioPostFields
            ...VideoPostFields

            author {
              id
            }
          }
        }
      }
    }
  }
`;

export const USERS_POSTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
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
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(filters: ["role"]) {
      pageInfo {
        ...PageInfoFields
      }

      edges {
        cursor

        node {
          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(filters: ["category"]) {
            pageInfo {
              ...PageInfoFields
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

export const USER_POSTS_COMMENTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
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

      posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(filters: ["category"]) {
        pageInfo {
          ...PageInfoFields
        }

        edges {
          cursor

          node {
            ...PostFields

            comments(first: $commentsFirst, after: $commentsAfter) @connection(filters: []) {
              pageInfo {
                ...PageInfoFields
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

export const USERS_POSTS_COMMENTS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
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
    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection(filters: ["role"]) {
      pageInfo {
        ...PageInfoFields
      }

      edges {
        cursor

        node {
          ...UserFields

          posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection(filters: ["category"]) {
            pageInfo {
              ...PageInfoFields
            }

            edges {
              cursor

              node {
                ...PostFields

                comments(first: $commentsFirst, after: $commentsAfter) @connection {
                  pageInfo {
                    ...PageInfoFields
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

export const MULTIPLE_USERS_QUERY = `
  ${PAGE_INFO_FRAGMENT}
  ${USER_FRAGMENT}

  query Multiple($userId: ID!, $usersRole: String, $usersFirst: Int, $usersAfter: String) {
    user(id: $userId) {
      ...UserFields
    }

    users(role: $usersRole, first: $usersFirst, after: $usersAfter) @connection {
      pageInfo {
        ...PageInfoFields
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

export const UPDATE_USER_MUTATION = gql`
  ${USER_FRAGMENT}

  mutation UpdateUserMutation($input: UpdateUserInput!, $postCategory: String!, $postFirst: Int!, $postAfter: String!) {
    updateUser(id: $id, input: $input) {

      user {
        ...UserFields

        posts(category: $postsCategory, first: $postsFirst, after: $postsAfter) @connection {
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
      }
    }
  }
`;

export const POST_COMMENTS_QUERY = gql`
  ${PAGE_INFO_FRAGMENT}
  ${COMMENT_FRAGMENT}

  query PostCommentsQuery($postId: ID!, $first: Int, $after: String, $last: Int, $before: String) {
    post(id: $postId) {
      id
      comments(first: $first, after: $after, last: $last, before: $before) @connection(filters: [], mode: "page") {
        totalCount
        pageInfo {
          ...PageInfoFields
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
`;
