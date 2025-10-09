import { IDENTITY_FIELDS, CONNECTION_FIELDS, ROOT_ID } from "./constants";
import type { GraphInstance } from "./graph";
import type { PlanField } from "../compiler/types";


export const isObject = (value: any): value is Record<string, any> => {
  return value !== null && typeof value === "object";
};

export const hasTypename = (value: any): boolean => {
  return !!(value && typeof value === "object" && typeof value.__typename === "string");
};

export const isPureIdentity = (value: any): boolean => {
  if (!isObject(value)) {
    return false;
  }

  const keys = Object.keys(value);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    if (!IDENTITY_FIELDS.has(key) && value[key] !== undefined) {
      return true;
    }
  }

  return false;
};

export const stableStringify = (object: any): string => {
  const walk = (object: any): any => {
    if (!isObject(object)) {
      return object;
    }

    if (Array.isArray(object)) {
      return object.map(walk);
    }

    const result: Record<string, any> = {};

    for (let i = 0, keys = Object.keys(object).sort(); i < keys.length; i++) {
      const key = keys[i];

      result[key] = walk(object[key]);
    }

    return result;
  };

  try {
    return JSON.stringify(walk(object));
  } catch {
    return "";
  }
};

export const TRAVERSE_SKIP = Symbol("traverse:skip");
export const TRAVERSE_OBJECT = Symbol("traverse:object");
export const TRAVERSE_ARRAY = Symbol("traverse:array");
export const TRAVERSE_SCALAR = Symbol("traverse:scalar");

export const traverseFast = (
  root: any,
  context: any,
  visit: (
    parentNode: any,
    valueNode: any,
    fieldKey: string | number | null,
    kind: typeof TRAVERSE_OBJECT | typeof TRAVERSE_ARRAY | typeof TRAVERSE_SCALAR,
    context: any
  ) => typeof TRAVERSE_SKIP | any | void,
) => {
  const stack = [null, root, null, context];

  while (stack.length > 0) {
    const currentContext = stack.pop();
    const fieldKey = stack.pop();
    const valueNode = stack.pop();
    const parentNode = stack.pop();

    if (Array.isArray(valueNode)) {
      const nextContext = visit(parentNode, valueNode, fieldKey, TRAVERSE_ARRAY, currentContext);
      if (nextContext === TRAVERSE_SKIP) continue;
      const ctx = nextContext ?? currentContext;

      for (let i = valueNode.length - 1; i >= 0; i--) {
        const childValue = valueNode[i];
        if (isObject(childValue)) {
          stack.push(valueNode, childValue, i, ctx);
        } else {
          visit(valueNode, childValue, i, TRAVERSE_SCALAR, ctx);
        }
      }
    } else if (isObject(valueNode)) {
      const nextContext = visit(parentNode, valueNode, fieldKey, TRAVERSE_OBJECT, currentContext);
      if (nextContext === TRAVERSE_SKIP) continue;
      const ctx = nextContext ?? currentContext;

      for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
        const key = fieldKeys[i];
        const childValue = valueNode[key];

        if (isObject(childValue)) {
          stack.push(valueNode, childValue, key, ctx);
        } else {
          visit(valueNode, childValue, key, TRAVERSE_SCALAR, ctx);
        }
      }
    } else {
      visit(parentNode, valueNode, fieldKey, TRAVERSE_SCALAR, currentContext);
    }
  }
};

/**
 * Build a field link key used on a record snapshot, e.g.:
 *   user({"id":"u1"})
 *
 * NOTE: `field.stringifyArgs(vars)` expects RAW variables; it internally runs the compiled
 * `buildArgs` to map variable names → field-arg names and drops undefined.
 */
export const buildFieldKey = (field: PlanField, variables: Record<string, any>): string => {
  const args = field.stringifyArgs(variables);

  return args === "{}" ? field.fieldName : `${field.fieldName}(${args})`;
};

export const buildConnectionKey = (
  field: PlanField,
  parentId: string,
  variables: Record<string, any>,
): string => {
  // parentId can be "@", "Type:id", "Type:id.container", or already absolute like "@.X.Y"
  const base = parentId[0] === ROOT_ID ? parentId : `@.${parentId}`;
  return `${base}.${field.fieldName}(${field.stringifyArgs(variables)})`;
};

/**
 * Build the canonical connection key (filters-only identity) under the `@connection.` namespace, e.g.:
 *   @connection.posts({"category":"tech"})
 *   @connection.User:u1.posts({"category":"tech","sort":"hot"})
 *
 * - Uses `field.connectionKey` (directive key) when available; falls back to the field name.
 * - If `field.connectionFilters` is present, use only those arg names (when present in args).
 * - Otherwise, include all non-pagination args derived from `buildArgs(vars)`.
 */
export const buildConnectionCanonicalKey = (
  field: PlanField,
  parentId: string,
  variables: Record<string, any>,
): string => {
  const allArgs = field.buildArgs(variables) || {};

  const filters =
    Array.isArray(field.connectionFilters) && field.connectionFilters.length > 0
      ? field.connectionFilters
      : Object.keys(allArgs).filter((k) => !CONNECTION_FIELDS.has(k));

  const identity: Record<string, any> = {};
  for (let i = 0; i < filters.length; i++) {
    const name = filters[i];
    if (name in allArgs) identity[name] = allArgs[name];
  }

  const keyPart = field.connectionKey || field.fieldName; // prefer directive key; fallback to field
  const parentPart = parentId === ROOT_ID ? "@connection." : `@connection.${parentId}.`;
  return `${parentPart}${keyPart}(${stableStringify(identity)})`;
};


export const upsertEntityShallow = (graph: GraphInstance, node: any): string | null => {
  const entityKey = graph.identify(node);
  if (!entityKey) return null;

  const snapshot: Record<string, any> = {
    __typename: node.__typename,
    id: node.id != null ? String(node.id) : undefined,
  };

  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    const field = keys[i];
    if (IDENTITY_FIELDS.has(field)) continue;

    const value = node[field];

    // skip connection-like
    if (
      isObject(value) &&
      typeof (value as any).__typename === "string" &&
      (value as any).__typename.endsWith("Connection") &&
      Array.isArray((value as any).edges)
    ) {
      continue;
    }

    // identifiable child
    if (isObject(value) && hasTypename(value) && value.id != null) {
      const childKey = graph.identify(value);
      if (childKey) {
        graph.putRecord(childKey, { __typename: value.__typename, id: String(value.id) });
        snapshot[field] = { __ref: childKey };
        continue;
      }
    }

    // arrays (may contain identifiable)
    if (Array.isArray(value)) {
      const out = new Array(value.length);
      for (let j = 0; j < value.length; j++) {
        const item = value[j];
        if (isObject(item) && hasTypename(item) && item.id != null) {
          const childKey = graph.identify(item);
          if (childKey) {
            graph.putRecord(childKey, { __typename: item.__typename, id: String(item.id) });
            out[j] = { __ref: childKey };
          } else {
            out[j] = item;
          }
        } else {
          out[j] = item;
        }
      }
      snapshot[field] = out;
      continue;
    }

    // plain scalar/object
    snapshot[field] = value;
  }

  graph.putRecord(entityKey, snapshot);
  return entityKey;
};
