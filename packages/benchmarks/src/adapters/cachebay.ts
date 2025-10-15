import { createCachebay } from "../../../cachebay/src/core";
import { createYogaFetcher } from '../utils/graphql';

export type CachebayPluginConfig = {
  yoga: any;
  cachePolicy?: "network-only" | "cache-first" | "cache-and-network";
};

export const createCachebayPlugin = ({ yoga, cachePolicy }: CachebayPluginConfig) => {
  const fetcher = createYogaFetcher(yoga, 'http://localhost/graphql');

  const transport = {
    http: async (context: any) => {
      const result = await fetcher(context.query, context.variables);

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
