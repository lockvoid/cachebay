import { getCachebay } from "./context";
import type { OperationResult } from "../../core";
import type { DocumentNode } from "graphql";

/**
 * createMutation options
 */
export interface CreateMutationOptions {
  /** GraphQL mutation document */
  query: DocumentNode | string;
}

/**
 * createMutation return value
 */
export interface CreateMutationReturn<TData = any, TVars = any> {
  /** Mutation data (reactive) */
  readonly data: TData | null;
  /** Error if mutation failed */
  readonly error: Error | null;
  /** Fetching state */
  readonly isFetching: boolean;
  /** Execute the mutation */
  execute: (variables?: TVars) => Promise<OperationResult<TData>>;
}

/**
 * Reactive GraphQL mutation
 * @param options - Mutation options with query
 * @returns Reactive mutation state and execute function
 */
export function createMutation<TData = any, TVars = any>(
  options: CreateMutationOptions,
): CreateMutationReturn<TData, TVars> {
  const client = getCachebay();

  let data = $state<TData | null>(null);
  let error = $state<Error | null>(null);
  let isFetching = $state(false);

  /**
   * Execute the mutation
   */
  const execute = async (variables?: TVars): Promise<OperationResult<TData>> => {
    isFetching = true;
    error = null;

    try {
      const result = await client.executeMutation<TData, TVars>({
        query: options.query,
        variables: variables || ({} as TVars),
      });

      if (result.error) {
        error = result.error;
      } else {
        data = result.data;
      }

      return result;
    } catch (err) {
      const errorResult = {
        data: null,
        error: err as Error,
      };
      error = err as Error;
      return errorResult;
    } finally {
      isFetching = false;
    }
  };

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
    execute,
  };
}
