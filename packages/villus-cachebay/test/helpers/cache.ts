import { getOperationKey, ensureDocumentHasTypenameSmart } from '../../src/core/utils';

export async function seedCache(
  cache: any,
  {
    query,
    variables = {},
    data,
    materialize = true,
  }: {
    query: any;
    variables?: Record<string, any>;
    data: any;
    materialize?: boolean;
  }
) {
  // Ensure the query has typenames, just like the plugin does
  const queryWithTypenames = ensureDocumentHasTypenameSmart(query);
  const opKey = getOperationKey({ type: "query", query: queryWithTypenames, variables, context: {} } as any);

  cache.hydrate(
    {
      op: [[opKey, { data, variables }]],
    },
    { materialize },
  );
}
