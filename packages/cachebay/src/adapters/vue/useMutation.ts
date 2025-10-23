import { ref, type Ref } from "vue";
import { useCachebay } from "./useCachebay";
import type { Operation, OperationResult } from "../../core/operations";
import type { DocumentNode } from "graphql";

/**
 * useMutation return value
 */
export interface UseMutationReturn<TData = any, TVars = any> {
  /** Mutation data (reactive) */
  data: Ref<TData | null>;
  /** Error if mutation failed */
  error: Ref<Error | null>;
  /** Fetching state */
  isFetching: Ref<boolean>;
  /** Execute the mutation */
  execute: (variables?: TVars) => Promise<OperationResult<TData>>;
}

/**
 * Reactive GraphQL mutation hook
 * @param mutation - GraphQL mutation document
 * @returns Mutation state and execute function
 */
export function useMutation<TData = any, TVars = any>(
  mutation: DocumentNode | string
): UseMutationReturn<TData, TVars> {
  const client = useCachebay();

  const data = ref<TData | null>(null) as Ref<TData | null>;
  const error = ref<Error | null>(null);
  const isFetching = ref(false);

  /**
   * Execute the mutation
   */
  const execute = async (variables?: TVars): Promise<OperationResult<TData>> => {
    isFetching.value = true;
    error.value = null;

    try {
      const result = await client.executeMutation<TData, TVars>({
        query: mutation,
        variables: variables || ({} as TVars),
      });

      if (result.error) {
        error.value = result.error;
      } else {
        data.value = result.data;
      }

      return result;
    } catch (err) {
      const errorResult = {
        data: null,
        error: err as Error,
      };
      error.value = err as Error;
      return errorResult;
    } finally {
      isFetching.value = false;
    }
  };

  return {
    data,
    error,
    isFetching,
    execute,
  };
}
