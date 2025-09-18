import { IDENTITY_FIELDS, ROOT_ID } from "./constants";
import type { EntityKey, RelayOptions } from "./types";

export const TRAVERSE_SKIP = Symbol('traverse:skip');

export const isObject = (value: any): value is Record<string, any> => {
  return value !== null && typeof value === "object";
}

export const hasTypename = (value: any): boolean => {
  return !!(value && typeof value === "object" && typeof value.__typename === "string");
}

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
    return '';
  }
}

export const traverseFast = (root: any, context: any, visit: (parentNode: any, valueNode: any, fieldKey: string | number | null, context: any) => typeof TRAVERSE_SKIP | { context: any } | void) => {
  const stack = [null, root, null, context];

  while (stack.length > 0) {
    const currentContext = stack.pop();
    const fieldKey = stack.pop();
    const valueNode = stack.pop();
    const parentNode = stack.pop();

    if (Array.isArray(valueNode)) {
      const nextContext = visit(parentNode, valueNode, fieldKey, currentContext);

      if (nextContext === TRAVERSE_SKIP) {
        continue;
      }

      for (let i = valueNode.length - 1; i >= 0; i--) {
        const childValue = valueNode[i];

        if (!isObject(childValue)) {
          continue;
        }

        stack.push(valueNode, childValue, i, nextContext ?? currentContext);
      }
    } else if (isObject(valueNode)) {
      const nextContext = visit(parentNode, valueNode, fieldKey, currentContext);

      if (nextContext === TRAVERSE_SKIP) {
        continue;
      }

      for (let i = 0, fieldKeys = Object.keys(valueNode); i < fieldKeys.length; i++) {
        const childValue = valueNode[fieldKeys[i]];

        if (!isObject(childValue)) {
          continue;
        }

        stack.push(valueNode, childValue, fieldKeys[i], nextContext ?? currentContext);
      }
    }
  }
};

export const buildFieldKey = (field: PlanField, variables: Record<string, any>): string => {
  // Per your contract: stringifyArgs receives raw variables and applies buildArgs internally
  return `${field.fieldName}(${field.stringifyArgs(variables)})`;
};

export const buildConnectionKey = (
  field: PlanField,
  parentRecordId: string,
  variables: Record<string, any>
): string => {
  const prefix = parentRecordId === ROOT_ID ? "@." : `@.${parentRecordId}.`;
  return `${prefix}${field.fieldName}(${field.stringifyArgs(variables)})`;
};

export const buildConnectionIdentityKey = (
  field: PlanField,
  parentRecordId: string,
  variables: Record<string, any>
) => {
  const args = field.buildArgs(variables) || {};
  const names = field.connectionArgs ?? Object.keys(args).filter(k => !["first", "last", "after", "before"].includes(k));
  const identity: Record<string, any> = {};
  for (let i = 0; i < names.length; i++) identity[names[i]] = args[names[i]];
  const prefix = parentRecordId === ROOT_ID ? "@." : `@.${parentRecordId}.`;
  return `${prefix}${field.fieldName}(${JSON.stringify(identity)})#identity`;
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
