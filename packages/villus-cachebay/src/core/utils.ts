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
