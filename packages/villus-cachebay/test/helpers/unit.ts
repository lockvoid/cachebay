import { visit, Kind, type DocumentNode } from "graphql";
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler/compile";
import { ROOT_ID } from "@/src/core/constants";

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


export const TEST_QUERIES = {
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

export const createTestPlan = (query: DocumentNode) => {
  return compileToPlan(query);
};
