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

/**
 * Selection registry for a normalized GraphQL cache.
 *
 * What is a "selection"?
 *
 * A selection is a stored field result skeleton (like a connection page) with
 * a stable cache key. It excludes entity normalization - entities are stored
 * separately. Selections enable deterministic re-materialization of lists and
 * pages across renders, pagination, and SSR.
 *
 * Key builders:
 *
 * - buildQuerySelectionKey(field, args) → "posts({\"first\":2})"
 * - buildFieldSelectionKey(entityKey, field, args) → "User:1.posts({\"first\":2})"
 *
 * Selection tracking:
 *
 * - markSelection(subtree, {entityKey, field, args}) - Marks a subtree for persistence
 * - compileSelections(data) - Extracts all marked selections plus root fields
 *
 * Design principles:
 *
 * - No payload mutation - metadata stored in WeakMap
 * - Stable keys - identical args produce identical keys regardless of order
 * - Separation of concerns - selections and entities stored independently
 *
 * Example:
 * ```js
 * // Mark a connection for persistence
 * markSelection(payload.user.posts, {
 *   entityKey: "User:1",
 *   field: "posts",
 *   args: { first: 2 }
 * });
 *
 * // Extract all selections for storage
 * const entries = compileSelections(payload);
 * // → [
 * //     { key: "user({})", subtree: payload.user },
 * //     { key: "User:1.posts({\"first\":2})", subtree: payload.user.posts }
 * //   ]
 * ```
 */
export const createSelections = () => {
  const marks = new WeakMap<object, SelectionMark>();

  /**
   * Builds a selection key for query-level fields.
   * @param field - The field name (e.g., "user", "posts")
   * @param args - Optional arguments for the field
   * @returns A stable selection key like "user({})" or "posts({first:10})"
   */
  const buildQuerySelectionKey = (field: string, args?: Record<string, any>): string => {
    const argsString = args ? stableStringify(args) : "{}";

    return `${field}(${argsString})`;
  };

  /**
   * Builds a selection key for entity sub-fields.
   * @param entityKey - The parent entity key (e.g., "User:1")
   * @param field - The field name on the entity
   * @param args - Optional arguments for the field
   * @returns A stable selection key like "User:1.posts({first:10})"
   */
  const buildFieldSelectionKey = (entityKey: string, field: string, args?: Record<string, any>): string => {
    const argsString = args ? stableStringify(args) : "{}";

    return `${entityKey}.${field}(${argsString})`;
  };

  /**
   * Marks a subtree as a selection skeleton for cache tracking.
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
   * Compiles all selections from a GraphQL response payload.
   * @param input - The GraphQL response with a `data` property
   * @returns Array of selection entries with their cache keys and subtrees
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
