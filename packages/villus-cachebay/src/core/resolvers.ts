// src/core/resolvers.ts
//
// Generic field-resolver framework, view-agnostic.
// - Binds resolver specs (including __cb_resolver__ factories).
// - Applies resolvers on plain objects (applyOnObject) or materialized trees.
// - Tracks per-object signature to avoid re-applying for identical vars/hints.
// - Supports argsIndex (path → args) so field resolvers receive ctx.args.
//
// NOTE: stateless helpers (stringify, etc.) are internal here;
// no external utils object is required.
//

export type ResolverHint = { stale?: boolean };

export type FieldResolverCtx = {
  parentTypename: string;
  field: string;
  parent: any;
  value: any;
  variables: Record<string, any>;
  hint?: ResolverHint;
  args?: Record<string, any>;         // ← args for THIS field (if available)
  set: (next: any) => void;
};

export type FieldResolver = (ctx: FieldResolverCtx) => void;

export type ResolversDict = Record<string, Record<string, FieldResolver | any>>;

export type ResolversConfig = {
  resolvers?: ResolversDict;
};

export type ResolversDeps = {
  graph: {
    materializeEntity: (key: string) => any;
    materializeSelection: (key: string) => any;
  };
};

// simple stable stringify for signature
const stableStringify = (value: any): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
};

const RESOLVE_SIGNATURE = Symbol.for("cachebay.resolve.signature");

export type ApplyObjectOptions = {
  argsIndex?: Map<string, Record<string, any>>;
};

export const createResolvers = (
  config: ResolversConfig,
  deps: ResolversDeps
) => {
  const { graph } = deps;
  const specs = config.resolvers || {};

  // Bind tree: supports { __cb_resolver__: true, bind(deps) } specs
  const FIELD_RESOLVERS: Record<string, Record<string, FieldResolver>> = {};
  for (const typename of Object.keys(specs)) {
    const fieldMap = specs[typename]!;
    const out: Record<string, FieldResolver> = {};
    for (const fieldName of Object.keys(fieldMap)) {
      const candidate = fieldMap[fieldName];
      if (
        candidate &&
        typeof candidate === "object" &&
        candidate.__cb_resolver__ === true &&
        typeof candidate.bind === "function"
      ) {
        out[fieldName] = candidate.bind({ graph });
      } else {
        out[fieldName] = candidate as FieldResolver;
      }
    }
    FIELD_RESOLVERS[typename] = out;
  }

  const applyFieldResolvers = (
    parentTypename: string,
    objectValue: any,
    variables: Record<string, any>,
    hint?: ResolverHint,
    argsForThisField?: Record<string, any>
  ) => {
    const map = FIELD_RESOLVERS[parentTypename];
    if (!map || !objectValue || typeof objectValue !== "object") {
      return;
    }

    const signature = (hint?.stale ? "S|" : "F|") + stableStringify(variables || {});
    if ((objectValue as any)[RESOLVE_SIGNATURE] === signature) {
      return;
    }

    for (const fieldName of Object.keys(map)) {
      const resolver = map[fieldName];
      if (typeof resolver !== "function") {
        continue;
      }
      const currentValue = objectValue[fieldName];

      resolver({
        parentTypename,
        field: fieldName,
        parent: objectValue,
        value: currentValue,
        variables,
        hint,
        args: argsForThisField,
        set: (next: any) => {
          objectValue[fieldName] = next;
        },
      });
    }

    (objectValue as any)[RESOLVE_SIGNATURE] = signature;
  };

  const applyOnObject = (
    root: any,
    variables: Record<string, any>,
    hint: ResolverHint = {},
    extra?: ApplyObjectOptions
  ) => {
    if (!root || typeof root !== "object") {
      return;
    }

    // We build a runtime path using JSON keys (alias-friendly)
    const currentPath: string[] = ["Query"];
    const stack: Array<{ typename: string | null; node: any; atKey?: string }> = [
      { typename: "Query", node: root },
    ];

    const join = (xs: string[]) => xs.join(".");

    while (stack.length) {
      const frame = stack.pop()!;
      const { typename: parentTypename, node, atKey } = frame;
      if (!node || typeof node !== "object") {
        continue;
      }

      if (atKey) {
        currentPath.push(atKey);
      }

      const typename = (node as any).__typename ?? parentTypename ?? null;
      if (typename) {
        const argsForThisField = extra?.argsIndex?.get(join(currentPath));
        applyFieldResolvers(typename, node, variables, hint, argsForThisField);
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (!value || typeof value !== "object") {
          continue;
        }
        if (Array.isArray(value)) {
          for (let i = value.length - 1; i >= 0; i--) {
            const it = value[i];
            if (it && typeof it === "object") {
              stack.push({ typename, node: it, atKey: key });
            }
          }
        } else {
          stack.push({ typename, node: value, atKey: key });
        }
      }

      if (atKey) {
        currentPath.pop();
      }
    }
  };

  const applyOnEntity = (
    entityKey: string,
    variables: Record<string, any>,
    hint?: ResolverHint
  ) => {
    const proxy = graph.materializeEntity(entityKey);
    applyOnObject(proxy, variables, hint);
    return proxy;
  };

  const applyOnSelection = (
    selectionKey: string,
    variables: Record<string, any>,
    hint?: ResolverHint,
    opts?: ApplyObjectOptions
  ) => {
    const tree = graph.materializeSelection(selectionKey);
    applyOnObject(tree, variables, hint, opts);
    return tree;
  };

  return {
    FIELD_RESOLVERS,
    applyFieldResolvers,
    applyOnObject,
    applyOnEntity,
    applyOnSelection,
  };
};
