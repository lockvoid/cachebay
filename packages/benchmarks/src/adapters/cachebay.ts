import { createCachebay } from "../../../cachebay/src";

export type CachebayPluginConfig = {
  yoga: any;
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network";
};

/**
 * Creates a Cachebay plugin configured for nested query benchmarks
 * Uses Yoga directly (in-memory, no HTTP)
 */
export function createCachebayPlugin({ yoga, cachePolicy }: CachebayPluginConfig) {
  // Transport calls Yoga's fetch directly - no HTTP, no network, no serialization
  const transport = {
    http: async (context: any) => {
      // Use Yoga's fetch API (works in-memory without HTTP)
      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });

      const result = await response.json();

      return {
        data: result.data || null,
        error: result.errors?.[0] || null
      };
    },
  };

  const plugin = createCachebay({
    interfaces: { Node: ["User", "Post", "Comment"] },
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });

  return plugin;
}
