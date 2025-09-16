import { stableStringify, traverse } from "./utils";

type SelectionMark = {
  /** Canonical entity key, e.g. "Query" or "User:1" */
  entityKey: string;
  /** The unaliased field name on the parent entity, e.g. "posts" */
  field: string;
  /** Optional arguments used to shape the selection key (usually {}) */
  args?: Record<string, any>;
};

export type SelectionsAPI = ReturnType<typeof createSelections>;

export const createSelections = () => {
  const marks = new WeakMap<object, SelectionMark>();

  /**
   * Builds a selection key for query-level fields.
   *
   * @param field - The field name (e.g., "user", "posts")
   * @param args - Optional arguments for the field
   * @return A stable selection key like "user({})" or "posts({first:10})"
   */
  const buildQuerySelectionKey = (field: string, args?: Record<string, any>): string => {
    const argsString = args ? stableStringify(args) : "{}";

    return `${field}(${argsString})`;
  };

  /**
   * Builds a selection key for entity sub-fields.
   *
   * @param entityKey - The parent entity key (e.g., "User:1")
   * @param field - The field name on the entity
   * @param args - Optional arguments for the field
   * @return A stable selection key like "User:1.posts({first:10})"
   */
  const buildFieldSelectionKey = (entityKey: string, field: string, args?: Record<string, any>): string => {
    const argsString = args ? stableStringify(args) : "{}";

    return `${entityKey}.${field}(${argsString})`;
  };

  /**
   * Marks a subtree as a selection skeleton for cache tracking.
   *
   * @param subtree - The data subtree to mark
   * @param meta - Selection metadata (entity key, field name, args)
   */
  const markSelection = (subtree: object, meta: SelectionMark): void => {
    if (!subtree || typeof subtree !== "object" || Array.isArray(subtree)) {
      return;
    }

    marks.set(subtree, meta);
  };

  /**
   * Compiles all selections from a GraphQL response.
   *
   * @param data - The response data
   * @return Array of selection entries with their cache keys and subtrees
   */
  const compileSelections = (data: Array<{ key: string; subtree: any }>) => {
    const result: Array<{ key: string; subtree: any }> = [];

    if (!data || typeof data !== "object") {
      return result;
    }

    // 1. Always emit a query selection key for data fields

    const dataKeys = Object.keys(data);

    for (let i = 0; i < dataKeys.length; i++) {
      const field = dataKeys[i];
      const key = buildQuerySelectionKey(field, {});
      const subtree = data[field];

      result.push({ key, subtree });
    }

    // 2. Traverse the entire tree; include only nodes explicitly marked as selections

    const processedKeys = new Set<string>();

    traverse(data, (node) => {
      if (!node || typeof node !== "object") {
        return;
      }

      const mark = marks.get(node);

      if (!mark) {
        return;
      }

      const key = buildFieldSelectionKey(mark.entityKey, mark.field, mark.args || {});

      if (!processedKeys.has(key)) {
        processedKeys.add(key);

        result.push({ key, subtree: node });
      }
    });

    return result;
  };

  return {
    buildQuerySelectionKey,
    buildFieldSelectionKey,
    markSelection,
    compileSelections,
  };
};
