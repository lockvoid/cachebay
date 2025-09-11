// src/core/resolvers.ts
import type { FieldResolver, ResolversDict } from "../types";
import type { CachebayInternals } from "./types";
import type { GraphAPI } from "./graph";
import type { ViewsAPI } from "./views";
import { stableIdentityExcluding, buildConnectionKey } from "./utils";
import { RESOLVE_SIGNATURE } from "./constants";
import { isReactive, reactive } from "vue";

// Re-export your existing relay resolver (unchanged)
export { relay } from "../resolvers/relay";

// Relay-related helpers
export const relayResolverIndex = new Map<string, any>();
export const relayResolverIndexByType = new Map<string, Map<string, any>>();

export function getRelayOptionsByType(typename: string | null, field: string): any {
  if (!typename) return null;
  const typeMap = relayResolverIndexByType.get(typename);
  if (!typeMap) return null;
  return typeMap.get(field);
}

export function setRelayOptionsByType(typename: string, field: string, options: any): void {
  let typeMap = relayResolverIndexByType.get(typename);
  if (!typeMap) {
    typeMap = new Map();
    relayResolverIndexByType.set(typename, typeMap);
  }
  typeMap.set(field, options);
}

export type ResolversDependencies = {
  graph: GraphAPI;
  views: ViewsAPI;
};

export function createResolvers(
  options: {
    resolvers?: ResolversDict;
  },
  dependencies: ResolversDependencies
) {
  const { resolvers: resolverSpecs } = options;
  const { graph, views } = dependencies;

  // Relay-related state that resolvers need
  const relayOptionsByType = new Map<string, Map<string, any>>();
  
  const setRelayOptionsByType = (typename: string, field: string, opts: any) => {
    if (!relayOptionsByType.has(typename)) {
      relayOptionsByType.set(typename, new Map());
    }
    relayOptionsByType.get(typename)!.set(field, opts);
  };
  
  const getRelayOptionsByType = (typename: string, field: string) => {
    return relayOptionsByType.get(typename)?.get(field);
  };

  // Create utils object with helper functions
  const utils = {
    TYPENAME_KEY: '__typename',
    setRelayOptionsByType,
    buildConnectionKey,
    readPathValue: (obj: any, path: string) => {
      if (!obj || !path) return undefined;
      const parts = path.split('.');
      let current = obj;
      for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
      }
      return current;
    },
    applyFieldResolvers: null as any, // Will be set after FIELD_RESOLVERS is created
  };

  function bindResolversTree(
    tree: ResolversDict | undefined,
    inst: any
  ): Record<string, Record<string, FieldResolver>> {
    const out: Record<string, Record<string, FieldResolver>> = {};
    if (!tree) return out;
    for (const type in tree) {
      out[type] = {};
      for (const field in tree[type]) {
        const spec = (tree[type] as any)[field];
        // Check if it's a resolver spec that needs binding
        if (spec && typeof spec === 'object' && spec.__cb_resolver__ === true && typeof spec.bind === 'function') {
          // Pass core dependencies directly
          const deps = { graph, views, utils };
          out[type][field] = spec.bind(deps);
        } else {
          // Regular resolver function
          out[type][field] = spec as FieldResolver;
        }
      }
    }
    return out;
  }

  const FIELD_RESOLVERS = bindResolversTree(resolverSpecs, null);

  function applyFieldResolvers(typename: string, obj: any, vars: Record<string, any>, hint?: { stale?: boolean }) {
    const map = FIELD_RESOLVERS[typename];
    if (!map) return;
    const sig = (hint?.stale ? "S|" : "F|") + stableIdentityExcluding(vars || {}, []);
    if ((obj as any)[RESOLVE_SIGNATURE] === sig) return;
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
    (obj as any)[RESOLVE_SIGNATURE] = sig;
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

  return { applyFieldResolvers, applyResolversOnGraph, FIELD_RESOLVERS, getRelayOptionsByType };
}

// Export makeApplyFieldResolvers for compatibility
export function makeApplyFieldResolvers(config: { TYPENAME_KEY: string; FIELD_RESOLVERS: Record<string, Record<string, FieldResolver>> }) {
  const { TYPENAME_KEY, FIELD_RESOLVERS } = config;
  
  return function applyFieldResolvers(typename: string, obj: any, vars: Record<string, any>, hint?: { stale?: boolean }) {
    const map = FIELD_RESOLVERS[typename];
    if (!map) return;
    const sig = (hint?.stale ? "S|" : "F|") + stableIdentityExcluding(vars || {}, []);
    if ((obj as any)[RESOLVE_SIGNATURE] === sig) return;
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
    (obj as any)[RESOLVE_SIGNATURE] = sig;
  };
}

// Export applyResolversOnGraph for compatibility
export function applyResolversOnGraph(root: any, variables: Record<string, any>, hint: { stale?: boolean }, config: { TYPENAME_KEY: string; FIELD_RESOLVERS: Record<string, Record<string, FieldResolver>> }) {
  const { TYPENAME_KEY, FIELD_RESOLVERS } = config;
  const stack: Array<{ pt: string | null; obj: any }> = [{ pt: "Query", obj: root }];
  while (stack.length) {
    const cur = stack.pop()!;
    const pt = (cur.obj && (cur.obj as any)[TYPENAME_KEY]) || cur.pt;
    const kk = Object.keys(cur.obj || {});
    for (let i = 0; i < kk.length; i++) {
      const k = kk[i];
      const v = (cur.obj as any)[k];
      if (pt) {
        const resolver = FIELD_RESOLVERS[pt]?.[k];
        if (resolver) {
          resolver({ parentTypename: pt, field: k, parent: cur.obj, value: v, variables, set: (nv) => { (cur.obj as any)[k] = nv; }, hint });
        }
      }
      if (v && typeof v === "object") {
        if (Array.isArray(v)) for (let j = 0; j < v.length; j++) stack.push({ pt, obj: v[j] });
        else stack.push({ pt, obj: v });
      }
    }
  }
}


