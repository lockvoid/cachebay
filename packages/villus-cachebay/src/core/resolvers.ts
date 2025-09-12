// src/core/resolvers.ts
import { TYPENAME_FIELD, RESOLVE_SIGNATURE } from "./constants";
import { stableIdentityExcluding } from "./utils";
import type { FieldResolver, ResolversDict } from "../types";
import type { GraphAPI } from "./graph";

/** Dependencies for resolvers (views-free). */
export type ResolversDependencies = {
  graph: GraphAPI;
};

export function createResolvers(
  options: { resolvers?: ResolversDict },
  dependencies: ResolversDependencies
) {
  const { resolvers: resolverSpecs } = options || {};
  const { graph } = dependencies;

  // minimal helpers surfaced to bindable resolvers (if they need them)
  const utils = {
    TYPENAME_KEY: TYPENAME_FIELD,
    readPathValue(obj: any, path: string) {
      if (!obj || !path) return undefined;
      let cur: any = obj;
      for (const p of path.split(".")) {
        if (cur == null) return undefined;
        cur = cur[p];
      }
      return cur;
    },
  };

  /** Bind tree: supports { __cb_resolver__: true, bind(deps) } specs */
  function bindResolversTree(
    tree: ResolversDict | undefined
  ): Record<string, Record<string, FieldResolver>> {
    const out: Record<string, Record<string, FieldResolver>> = {};
    if (!tree) return out;

    for (const typename of Object.keys(tree)) {
      const fields = (tree as any)[typename] as Record<string, any>;
      out[typename] = {};
      for (const field of Object.keys(fields)) {
        const spec = fields[field];
        if (
          spec &&
          typeof spec === "object" &&
          spec.__cb_resolver__ === true &&
          typeof spec.bind === "function"
        ) {
          out[typename][field] = spec.bind({ graph, utils });
        } else {
          out[typename][field] = spec as FieldResolver;
        }
      }
    }
    return out;
  }

  const FIELD_RESOLVERS = bindResolversTree(resolverSpecs);

  /** Apply resolvers for a single object (by typename), in-place. */
  function applyFieldResolvers(
    typename: string,
    obj: any,
    vars: Record<string, any>,
    hint?: { stale?: boolean }
  ) {
    const map = FIELD_RESOLVERS[typename];
    if (!map || !obj || typeof obj !== "object") return;

    // Prevent re-applying for the same variables/hint
    const sig = (hint?.stale ? "S|" : "F|") + stableIdentityExcluding(vars || {}, []);
    if ((obj as any)[RESOLVE_SIGNATURE] === sig) return;

    for (const field of Object.keys(map)) {
      const resolver = map[field];
      if (typeof resolver !== "function") continue;
      const curVal = obj[field];

      resolver({
        parentTypename: typename,
        field,
        parent: obj,
        value: curVal,
        variables: vars,
        hint,
        set: (next: any) => {
          obj[field] = next;
        },
      });
    }

    (obj as any)[RESOLVE_SIGNATURE] = sig;
  }

  /**
   * Walk a result tree and apply resolvers BEFORE normalization.
   * Mutates `root` to canonical, post-resolver shape.
   */
  function applyResolversOnGraph(
    root: any,
    variables: Record<string, any>,
    hint: { stale?: boolean } = {}
  ) {
    if (!root || typeof root !== "object") return;

    const stack: Array<{ typename: string | null; node: any }> = [
      { typename: "Query", node: root },
    ];

    while (stack.length) {
      const { typename: parentType, node } = stack.pop()!;
      if (!node || typeof node !== "object") continue;

      const t = (node as any)[TYPENAME_FIELD] ?? parentType ?? null;

      if (t) applyFieldResolvers(t, node, variables, hint);

      // traverse children
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (!v || typeof v !== "object") continue;
        if (Array.isArray(v)) {
          for (let i = v.length - 1; i >= 0; i--) {
            const it = v[i];
            if (it && typeof it === "object") stack.push({ typename: t, node: it });
          }
        } else {
          stack.push({ typename: t, node: v });
        }
      }
    }
  }

  return {
    FIELD_RESOLVERS,
    applyFieldResolvers,
    applyResolversOnGraph,
  };
}
