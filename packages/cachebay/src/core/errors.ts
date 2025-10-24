import type { GraphQLError } from "graphql";

/**
 * Custom error types for cachebay
 */

/**
 * Error thrown when cache-only policy is used but no cached data exists
 */
export class CacheMissError extends Error {
  constructor(message = 'Cache miss: no data available for cache-only query') {
    super(message);
    this.name = 'CacheMissError';
  }
}

/**
 * Error returned when a query response arrives after a newer request
 * for the same query+variables has been initiated.
 * This is expected behavior and should be ignored by consumers.
 */
export class StaleResponseError extends Error {
  constructor(message = 'Response ignored: newer request in flight') {
    super(message);
    this.name = 'StaleResponseError';
  }
}

/**
 * Generate error message from network and GraphQL errors
 */
const generateErrorMessage = (networkError?: Error, graphqlErrors?: GraphQLError[]) => {
  let error = "";
  if (networkError !== undefined) {
    return (error = `[Network] ${networkError.message}`);
  }

  if (graphqlErrors !== undefined) {
    for (let i = 0; i < graphqlErrors.length; i++) {
      error += `[GraphQL] ${graphqlErrors[i].message}\n`;
    }
  }

  return error.trim();
};

/**
 * CombinedError - handles both network and GraphQL errors
 */
export class CombinedError extends Error {
  public name: "CombinedError";
  public message: string;
  public response: any;
  public networkError?: Error;
  public graphqlErrors?: GraphQLError[];

  constructor({
    response,
    networkError,
    graphqlErrors,
  }: {
    response?: any;
    networkError?: Error;
    graphqlErrors?: GraphQLError[];
  }) {
    const message = generateErrorMessage(networkError, graphqlErrors);
    super(message);

    this.name = "CombinedError";
    this.response = response;
    this.message = message;
    this.networkError = networkError;
    this.graphqlErrors = graphqlErrors;
  }

  toString() {
    return this.message;
  }
}
