export const tick = () => {
  new Promise((resolve) => setTimeout(resolve, 0));
};

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const raf = () => {
  return new Promise((resolve) =>
    (globalThis as any).requestAnimationFrame ? requestAnimationFrame(() => resolve()) : setTimeout(() => resolve(), 16),
  );
}


/** Treat the cache (plugin) as a function Villus will call with a context. */
export function asPlugin(cache: any) {
  return cache; // CachebayInstance is a ClientPlugin (callable)
}

/**
 * Publish a result through the plugin pipeline.
 * Returns the value passed to ctx.useResult — convenient for grabbing the view.
 */
export function publish(
  cache: any,
  data: any,
  query: string = 'query Q { __typename }',
  variables: Record<string, any> = {},
) {
  const plugin = asPlugin(cache);
  let published: any = null;

  const ctx: any = {
    operation: { type: 'query', query, variables, cachePolicy: 'cache-and-network', context: {} },
    useResult: (payload: any) => {
      published = payload;
    },
    afterQuery: () => { },
  };

  plugin(ctx);
  ctx.useResult({ data });
  return published;
}

/**
 * Seed an empty Relay connection so tests can mutate it optimistically later.
 */
export function seedRelay(
  cache: any,
  {
    field,
    connectionTypename,
    pageInfo = {
      __typename: 'PageInfo',
      endCursor: null,
      hasNextPage: false,
      startCursor: null,
      hasPreviousPage: false,
    },
    edges = [],
    query = `query Seed { ${field} { edges { cursor node { __typename id } } pageInfo { endCursor hasNextPage } } }`,
    variables = {},
  }: {
    field: string;
    connectionTypename: string;
    pageInfo?: any;
    edges?: any[];
    query?: string;
    variables?: Record<string, any>;
  },
) {
  return publish(
    cache,
    {
      __typename: 'Query',
      [field]: { __typename: connectionTypename, edges, pageInfo },
    },
    query,
    variables,
  );
}
