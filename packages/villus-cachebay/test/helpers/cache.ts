import { getOperationKey } from '../../src/core/utils';

export function seedCache(
  cache: any,
  {
    query,
    variables = {},
    data,
    materialize = true,
    rabbit = false,
  }: {
    query: any;
    variables?: Record<string, any>;
    data: any;
    materialize?: boolean;
  }
) {
  const opKey = getOperationKey({ type: "query", query, variables, context: {} } as any);

  cache.hydrate(
    {
      op: [[opKey, { data, variables }]],
    },
    { materialize, rabbit },
  );
}
