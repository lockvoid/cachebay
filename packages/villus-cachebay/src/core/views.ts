// src/core/views.ts
import { shallowReactive } from "vue";
import { buildConnectionKey, buildConnectionCanonicalKey } from "./utils";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler";

export type ViewsInstance = ReturnType<typeof createViews>;
export type ViewsDependencies = { graph: GraphInstance };

/**
 * Single entrypoint view layer.
 *
 * - Exported API: getView({ source, field?, variables, canonical })
 * - Entities: follows __ref / __refs, applies selection from `field`, returns read-only proxy
 * - Connections: stable, shallowReactive edges array (from edges.__refs),
 *                pageInfo/containers via __ref (reactive),
 *                optional relinking page → canonical containers when `canonical=true`
 * - Missing entity/container ref → `{}` (placeholder from graph.materializeRecord)
 * - Missing connection page key (string source not found) → `undefined`
 * - All views are read-only (`set` returns false)
 */
export const createViews = ({ graph }: ViewsDependencies) => {
  /**
   * Global cache:
   * WeakMap<
   *   proxy,
   *   { bySel: Map<selKey, Map<canonFlag, { view: any, edgesCache?: { refs: string[], array: any[], sourceArray: string[] } }>> }
   * >
   * selKey is the actual PlanField object (or null) for identity-stable caching.
   */
  const cache = new WeakMap<object, any>();

  const selectionKeyOf = (field?: PlanField | null) => field ?? null;

  const getOrCreateBucket = (proxy: object, selKey: any) => {
    let b = cache.get(proxy);
    if (!b) {
      b = { bySel: new Map() };
      cache.set(proxy, b);
    }
    let byCanon = b.bySel.get(selKey);
    if (!byCanon) {
      byCanon = new Map();
      b.bySel.set(selKey, byCanon);
    }
    return { bucket: b, byCanon };
  };

  const isConnectionRecord = (rec: any) =>
    !!rec &&
    typeof rec === "object" &&
    (
      // normalized connections: edges.__refs (preferred)
      Array.isArray(rec?.edges?.__refs) ||
      // fallback heuristic
      (typeof rec.__typename === "string" && rec.__typename.endsWith("Connection"))
    );

  /**
   * Deeply dereference inline structures to views:
   * - { __ref } → entity/container view
   * - { __refs: string[] } → array of entity/container views
   * - array → element-wise deref
   * - plain object → property-wise deref
   */
  const derefInline = (value: any, variables: Record<string, any>, canonical: boolean): any => {
    if (value == null || typeof value !== "object") return value;

    if ((value as any).__ref) {
      const child = graph.materializeRecord((value as any).__ref);
      return getView({ source: child, variables, canonical });
    }

    if ((value as any).__refs && Array.isArray((value as any).__refs)) {
      const refs = (value as any).__refs as string[];
      const out = new Array(refs.length);
      for (let i = 0; i < refs.length; i++) {
        const child = graph.materializeRecord(refs[i]);
        out[i] = getView({ source: child, variables, canonical });
      }
      return out;
    }

    if (Array.isArray(value)) {
      return value.map((v) => derefInline(v, variables, canonical));
    }

    const out: any = {};
    for (const k of Object.keys(value)) {
      out[k] = derefInline(value[k], variables, canonical);
    }
    return out;
  };

  /**
   * Connection branch: stable edges, container relinking, pageInfo via __ref.
   * `pageKeyStr` (if provided) enables canonical relinking of containers.
   * `field` is the PlanField for the connection; we use it to pass "edges" selection to edge items.
   */
  const getConnectionViewInner = (
    proxy: any,
    pageKeyStr: string | undefined,
    field: PlanField | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    selKey: any,
  ) => {
    const { byCanon } = getOrCreateBucket(proxy, selKey);
    const flag = canonical ? 1 : 0;
    const cached = byCanon.get(flag);
    if (cached?.view) return cached.view;

    const view = new Proxy(proxy, {
      get(target, prop, receiver) {
        // Stable edges array (built from edges.__refs)
        if (prop === "edges") {
          const refs: string[] | undefined = (target as any)?.edges?.__refs;
          if (!Array.isArray(refs)) {
            // allow null / undefined passthrough (e.g., edges: null)
            return Reflect.get(target, prop, receiver);
          }

          const entry = byCanon.get(flag) as any;
          const ec = entry?.edgesCache;

          // First read: construct shallowReactive stable array
          if (!ec) {
            const arr: any[] = shallowReactive([]);
            const edgesFieldPlan = field?.selectionMap?.get("edges");
            for (let i = 0; i < refs.length; i++) {
              const edgeProxy = graph.materializeRecord(refs[i]);
              arr.push(
                getView({
                  source: edgeProxy,
                  field: edgesFieldPlan,
                  variables,
                  canonical,
                }),
              );
            }
            const newEntry = { view, edgesCache: { refs: refs.slice(), array: arr, sourceArray: refs } };
            byCanon.set(flag, newEntry);
            return arr;
          }

          // Subsequent reads: detect changes in refs array identity or content
          const identityChanged = ec.sourceArray !== refs;
          const refsChanged =
            ec.refs.length !== refs.length ||
            !ec.refs.every((v: string, i: number) => v === refs[i]);

          if (identityChanged || refsChanged) {
            const arr = ec.array as any[];
            const edgesFieldPlan = field?.selectionMap?.get("edges");

            // shrink
            if (arr.length > refs.length) arr.splice(refs.length);
            // grow
            for (let i = arr.length; i < refs.length; i++) arr.splice(i, 0, undefined);

            // re-fill
            for (let i = 0; i < refs.length; i++) {
              const edgeProxy = graph.materializeRecord(refs[i]);
              arr[i] = getView({
                source: edgeProxy,
                field: edgesFieldPlan,
                variables,
                canonical,
              });
            }

            ec.refs = refs.slice();
            ec.sourceArray = refs;
          }

          return ec.array;
        }

        // Containers (including pageInfo) via __ref.
        // When canonical=true, optionally relink page containers to canonical containers if present.
        const raw = Reflect.get(target, prop, receiver);

        if (raw && typeof raw === "object" && (raw as any).__ref) {
          let refKey = (raw as any).__ref as string;

          if (canonical && pageKeyStr && refKey.includes("@.")) {
            // infer container name from ref tail (e.g., "...posts({}).aggregations" → "aggregations")
            const parts = refKey.split(".");
            const fieldName = parts[parts.length - 1];
            const canonicalContainerKey = `${pageKeyStr}.${fieldName}`;
            if (graph.getRecord(canonicalContainerKey)) {
              refKey = canonicalContainerKey;
            }
          }

          return getView({ source: refKey, variables, canonical });
        }

        // arrays/objects may nest containers or entity refs
        if (Array.isArray(raw)) return raw.map((v) => derefInline(v, variables, canonical));
        if (raw && typeof raw === "object") return derefInline(raw, variables, canonical);

        return raw;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() {
        return false;
      },
    });

    byCanon.set(flag, { view, edgesCache: cached?.edgesCache });
    return view;
  };

  /**
   * Entity/container branch: follows __ref / __refs, applies selection from `field`,
   * routes connection fields to the connection branch (with stable edges).
   */
  const getEntityViewInner = (
    proxy: any,
    field: PlanField | null | undefined,
    variables: Record<string, any>,
    canonical: boolean,
    selKey: any,
  ) => {
    const { byCanon } = getOrCreateBucket(proxy, selKey);
    const flag = canonical ? 1 : 0;
    const cached = byCanon.get(flag);
    if (cached?.view) return cached.view;

    const view = new Proxy(proxy, {
      get(target, prop, receiver) {
        // If selection identifies a connection field → hop to connection branch
        const planField =
          field && typeof prop === "string"
            ? field.selectionMap?.get(prop as string)
            : undefined;

        if (planField?.isConnection) {
          const typename = (target as any).__typename;
          const id = (target as any).id;
          const parentId =
            typename && id != null
              ? `${typename}:${id}`
              : (graph.identify({ __typename: typename, id }) || "");

          const pageKeyStr = canonical
            ? buildConnectionCanonicalKey(planField, parentId, variables)
            : buildConnectionKey(planField, parentId, variables);

          const pageProxy = graph.materializeRecord(pageKeyStr);
          if (!pageProxy) return undefined;

          return getConnectionViewInner(
            pageProxy,
            pageKeyStr,
            planField,
            variables,
            canonical,
            selectionKeyOf(planField),
          );
        }

        // regular field
        const raw = Reflect.get(target, prop, receiver);

        // follow __ref with nested selection when available
        if (raw && typeof raw === "object" && (raw as any).__ref) {
          const child = graph.materializeRecord((raw as any).__ref);
          const sub =
            field && typeof prop === "string"
              ? field.selectionMap?.get(prop as string)
              : undefined;

          return getView({
            source: child,
            field: sub ?? null,
            variables,
            canonical,
          });
        }

        // arrays/objects may contain nested refs/containers
        if (Array.isArray(raw)) return raw.map((v) => derefInline(v, variables, canonical));
        if (raw && typeof raw === "object") return derefInline(raw, variables, canonical);

        return raw;
      },
      has: (t, p) => Reflect.has(t, p),
      ownKeys: (t) => Reflect.ownKeys(t),
      getOwnPropertyDescriptor: (t, p) => Reflect.getOwnPropertyDescriptor(t, p),
      set() {
        return false;
      },
    });

    byCanon.set(flag, { view });
    return view;
  };

  /**
   * Public single entrypoint.
   *
   * - `source`: record key string OR a materialized proxy (entity/connection/container/edge) OR null
   * - `field`: PlanField describing the current selection (if any)
   * - `canonical`: whether nested connections use canonical keys
   */
  const getView = ({
    source,
    field = null,
    variables,
    canonical,
  }: {
    source: string | object | null;
    field?: PlanField | null;
    variables: Record<string, any>;
    canonical: boolean;
  }): any => {
    if (source == null) return source;

    // If a string key is provided, materialize it (entity/container/edge/connection page).
    const proxy =
      typeof source === "string" ? graph.materializeRecord(source) : source;

    // Missing connection page key → undefined (as per contract)
    if (typeof source === "string" && proxy == null) return undefined;

    // Missing entity/container ref → graph.materializeRecord returns {}, keep it (reactive placeholder).
    if (!proxy || typeof proxy !== "object") return proxy;

    const selKey = selectionKeyOf(field);

    // Detect connection pages (or when caller explicitly marks a connection via PlanField)
    if (isConnectionRecord(proxy) || field?.isConnection) {
      // When called with a string source, we can relay it for canonical relinking.
      const pageKeyStr = typeof source === "string" ? source : undefined;

      return getConnectionViewInner(
        proxy,
        pageKeyStr,
        field ?? undefined,
        variables,
        canonical,
        selKey,
      );
    }

    // Otherwise, entity/container branch
    return getEntityViewInner(
      proxy,
      field,
      variables,
      canonical,
      selKey,
    );
  };

  return { getView };
};
