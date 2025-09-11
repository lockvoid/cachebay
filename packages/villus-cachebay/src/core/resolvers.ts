// src/core/resolvers.ts
import type { FieldResolver, ResolversDict, ResolversFactory } from "../types";
import type { CachebayInternals } from "./types";
import { stableIdentityExcluding } from "./utils";

// Re-export your existing relay resolver (unchanged)
export { relay } from "../resolvers/relay";

export function bindResolvers(
  internals: CachebayInternals,
  resolverSpecs: ResolversDict | undefined,
) {
  const RESOLVE_SIG = Symbol("cb_resolve_sig");

  function bindResolversTree(
    tree: ResolversDict | undefined,
    inst: CachebayInternals
  ): Record<string, Record<string, FieldResolver>> {
    const out: Record<string, Record<string, FieldResolver>> = {};
    if (!tree) return out;
    for (const type in tree) {
      out[type] = {};
      for (const field in tree[type]) {
        const spec = (tree[type] as any)[field];
        out[type][field] =
          spec && (spec as any).__cb_resolver__ ? (spec as any).bind(inst) : (spec as FieldResolver);
      }
    }
    return out;
  }

  const FIELD_RESOLVERS = bindResolversTree(resolverSpecs, internals);

  function applyFieldResolvers(typename: string, obj: any, vars: Record<string, any>, hint?: { stale?: boolean }) {
    const map = FIELD_RESOLVERS[typename];
    if (!map) return;
    const sig = (hint?.stale ? "S|" : "F|") + stableIdentityExcluding(vars || {}, []);
    if ((obj as any)[RESOLVE_SIG] === sig) return;
    for (const field in map) {
      const resolver = map[field];
      if (!resolver) continue;
      const val = (obj as any)[field];
      resolver({
        parentTypename: typename,
        field,
        parent: obj,
        value: val,
        variables: vars,
        hint,
        set: (nv) => { (obj as any)[field] = nv; },
      });
    }
    (obj as any)[RESOLVE_SIG] = sig;
  }

  /** Walk result graph and run field resolvers */
  function applyResolversOnGraph(root: any, vars: Record<string, any>, hint: { stale?: boolean }) {
    const stack: Array<{ pt: string | null; obj: any }> = [{ pt: "Query", obj: root }];
    while (stack.length) {
      const cur = stack.pop()!;
      const pt = (cur.obj && (cur.obj as any).__typename) || cur.pt;
      const kk = Object.keys(cur.obj || {});
      for (let i = 0; i < kk.length; i++) {
        const k = kk[i];
        const v = (cur.obj as any)[k];
        if (pt) {
          const resolver = FIELD_RESOLVERS[pt]?.[k];
          if (resolver) {
            resolver({ parentTypename: pt, field: k, parent: cur.obj, value: v, variables: vars, set: (nv) => { (cur.obj as any)[k] = nv; }, hint });
          }
        }
        if (v && typeof v === "object") {
          if (Array.isArray(v)) for (let j = 0; j < v.length; j++) stack.push({ pt, obj: v[j] });
          else stack.push({ pt, obj: v });
        }
      }
    }
  }

  return { applyFieldResolvers, applyResolversOnGraph };
}
