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
