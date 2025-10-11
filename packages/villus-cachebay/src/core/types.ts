/**
 * Common GraphQL connection types for testing and type safety
 */

export interface PageInfo {
  __typename?: string;
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Edge<T = any> {
  __typename?: string;
  cursor: string;
  node: T;
  [key: string]: any;
}

export interface Connection<T = any> {
  __typename: string;
  edges: Array<Edge<T>>;
  pageInfo: PageInfo;
  [key: string]: any;
}

/**
 * Normalized edge reference in the graph
 */
export interface EdgeRef {
  __typename?: string;
  cursor?: string;
  node: { __ref: string };
  [key: string]: any;
}

/**
 * Edges as array of references
 */
export interface EdgesRef {
  __refs: string[];
}

/**
 * PageInfo reference in the graph
 */
export interface PageInfoRef {
  __ref: string;
}

/**
 * Normalized connection record in the graph (with inline pageInfo)
 */
export interface ConnectionRecord {
  __typename: string;
  edges: EdgesRef;
  pageInfo: PageInfo;
  [key: string]: any;
}

/**
 * Normalized connection reference in the graph (with pageInfo reference)
 */
export interface ConnectionRef {
  __typename: string;
  edges: EdgesRef;
  pageInfo: PageInfoRef;
  [key: string]: any;
}
