import { graphql } from 'relay-runtime';

export const RelayWriteQuery = graphql`
  query relayWriteQueryDefRelayWriteQuery($first: Int!, $after: String) {
    users(first: $first, after: $after) @connection(key: "relayWriteQueryDef_users") {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) @connection(key: "User_posts") {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) @connection(key: "Post_comments") {
                  edges {
                    cursor
                    node {
                      id
                      text
                      author {
                        id
                        name
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;
