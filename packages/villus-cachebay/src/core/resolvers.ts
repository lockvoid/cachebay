import { isObject } from "./utils";
import type { GraphInstance } from "@/src/core/graph";

export type Resolver = {
  bind: (deps: { graph: GraphInstance }) => ResolverFn;
}

export type ResolverFn = (context: { parent: any; field: string; value: any; variables: Record<string, any>; hint: Record<string, any>; set: (next: any) => void; }) => void;

export type ResolversConfig = {
  resolvers?: Record<string, Record<string, Resolver>>;
};

export type ResolversDependencies = {
  graph: GraphInstance;
};

export function createResolvers(config: ResolversConfig, dependencies: ResolversDependencies) {
  const { graph } = dependencies;

  const boundResolvers: Map<string, Map<string, ResolverFn>> = new Map();

  if (isObject(config.resolvers)) {
    for (const typename of Object.keys(config.resolvers)) {
      const fields = config.resolvers[typename] || {};

      const resolverFns = {};

      for (const field of Object.keys(fields)) {
        const resolver = fields[field];

        if (!isObject(resolver) || typeof resolver.bind !== "function") {
          throw new Error(`Resolver for ${typename}.${field} must be a factory with a .bind method`);
        }

        const resolverFn = resolver.bind({ graph });

        if (typeof resolverFn !== "function") {
          throw new Error(`Bound resolver for ${typename}.${field} must return a function`);
        }

        handlers[field] = resolverFn;
      }

      boundResolvers.set(typename, handlers);
    }
  }

  const applyResolvers = (root: any, vars: Record<string, any> = {}, hint?: { stale?: boolean }) => {
    if (!isObject(root)) {
      return;
    }

    // DFS stack: node + parent typename (fallback to current node typename)
    const stack: Array<{ node: any; parentTypename: string | null }> = [{ node: root, parentTypename: "Query" }];

    while (stack.length) {
      const { node, parentTypename } = stack.pop()!;
      if (!node || typeof node !== "object") continue;

      // Prefer explicit __typename when present
      const selfTypename: string | null =
        typeof node.__typename === "string" ? node.__typename : parentTypename ?? null;

      // Process each field in the node
      for (const key of Object.keys(node)) {
        const val = node[key];

        // Find and execute handler for this typename and field
        const handlers = selfTypename ? boundResolvers.get(selfTypename) : undefined;
        const handler = handlers ? handlers.get(key) : undefined;

        if (handler) {
          let nextAssigned = false;
          const set = (next: any) => {
            node[key] = next;
            nextAssigned = true;
          };

          handler({
            parent: node,
            field: key,
            value: val,
            variables: vars,
            hint,
            set,
          });
        }

        // Continue traversal into nested objects/arrays
        if (isObject(val)) {
          if (Array.isArray(val)) {
            for (let i = 0; i < val.length; i++) {
              const it = val[i];
              if (it && typeof it === "object") {
                stack.push({ node: it, parentTypename: selfTypename });
              }
            }
          } else {
            stack.push({ node: val, parentTypename: selfTypename });
          }
        }
      }
    }
  };

  return {
    applyResolvers,
  };
}
