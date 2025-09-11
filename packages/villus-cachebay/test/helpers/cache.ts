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

  // Clone data to avoid mutations
  const clonedData = JSON.parse(JSON.stringify(data));
  
  // Hydrate without materialize to avoid resolver mutations
  cache.hydrate(
    {
      op: [[opKey, { data: clonedData, variables }]],
    },
    { materialize: false },
  );
  
  // Now manually apply resolvers and materialize without mutating the operation store
  if (materialize && cache.__internals) {
    const { graph, resolvers, views } = cache.__internals;
    
    // Get the stored operation data (already in the store from hydrate)
    const storedOp = graph.operationStore.get(opKey);
    if (storedOp) {
      // Clone the data for processing
      const processData = JSON.parse(JSON.stringify(storedOp.data));
      
      // Apply resolvers and materialize on the clone
      resolvers.applyResolversOnGraph(processData, variables || {}, { stale: false });
      views.registerViewsFromResult(processData, variables || {});
      views.collectEntities(processData);
      views.materializeResult(processData);
    }
  }
  
  // Clear hydration tickets to prevent SSR-style handling in tests
  if (cache.__internals?.ssr?.hydrateOperationTicket) {
    cache.__internals.ssr.hydrateOperationTicket.clear();
  }
  
  // Wait a tick for the hydration to complete
  await new Promise(resolve => setTimeout(resolve, 0));
}
