import { gql } from "graphql-tag";
import { graphql } from "relay-runtime";

export const USERS_CACHEBAY_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) @connection {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) @connection(key: "posts") {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) @connection(key: "comments") {
                  edges {
                    cursor
                    node { id text author { id name } }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export const USERS_APOLLO_QUERY = gql`
  query Users($first: Int!, $after: String) {
    users(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          name
          avatar
          posts(first: 5, after: null) {
            edges {
              cursor
              node {
                id
                title
                likeCount
                comments(first: 3, after: null) {
                  edges {
                    cursor
                    node { id text author { id name } }
                  }
                  pageInfo { hasNextPage }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export const USERS_RELAY_QUERY = graphql`
  query apiUsersRelayQuery($first: Int!, $after: String) {
    users(first: $first, after: $after) @connection(key: "api_users") {
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

export const USER_PROFILE_QUERY = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      username
      phone
      website
      company
      bio
      avatar
      createdAt
      profile {
        id
        bio
        avatar
        location
        website
        twitter
        github
        linkedin
        followers
        following
      }
    }
  }
`;
