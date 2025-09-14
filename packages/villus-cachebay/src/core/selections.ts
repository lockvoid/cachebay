// src/core/selections.ts
import { stableStringify } from "./utils";

export type SelectionsConfig = {
  // reserved for future options (formatters, key policies, etc.)
};

type Deps = {
  graph: {
    identify: (obj: any) => string | null;
  };
};

export type SelectionsAPI = ReturnType<typeof createSelections>;

/**
 * Selection helpers:
 * - build stable selection keys for root fields and entity sub-fields
 * - heuristically compile selection entries (skeletons) from a payload subtree
 *
 * NOTE: This is a light heuristic. You can swap `compileSelections` with a
 * real GraphQL AST compiler later without changing the public API here.
 */
export const createSelections = ({
  config,
  dependencies,
}: {
  config?: SelectionsConfig;
  dependencies: Deps;
}) => {
  const { graph } = dependencies;

  const buildRootSelectionKey = (field: string, args?: Record<string, any>): string => {
    const argsString = args ? stableStringify(args) : "{}";
    return `${field}(${argsString})`;
  };

  const buildFieldSelectionKey = (
    parentEntityKey: string,
    field: string,
    args?: Record<string, any>
  ): string => {
    const argsString = args ? stableStringify(args) : "{}";
    return `${parentEntityKey}.${field}(${argsString})`;
  };

  /**
   * Heuristically emits:
   * - one root selection key per top-level field in `data`
   * - for every entity inside, any field shaped like a "connection"
   *   (object containing `edges` array AND `pageInfo` object)
   */
  const compileSelections = (input: { data: any }): Array<{ key: string; subtree: any }> => {
    const out: Array<{ key: string; subtree: any }> = [];
    const root = input.data;

    if (!root || typeof root !== "object") {
      return out;
    }

    // 1) root fields
    const rootKeys = Object.keys(root);
    for (let i = 0; i < rootKeys.length; i++) {
      const field = rootKeys[i];
      const subtree = (root as any)[field];
      out.push({ key: buildRootSelectionKey(field, {}), subtree });

      // 2) nested “connection-like” fields keyed by parent entity
      traverse(subtree, (parent) => {
        const parentKey = graph.identify(parent);
        if (!parentKey) {
          return;
        }

        const parentFieldKeys = Object.keys(parent);
        for (let j = 0; j < parentFieldKeys.length; j++) {
          const k = parentFieldKeys[j];
          const v = (parent as any)[k];
          if (v && typeof v === "object" && Array.isArray((v as any).edges) && (v as any).pageInfo) {
            out.push({ key: buildFieldSelectionKey(parentKey, k, {}), subtree: v });
          }
        }
      });
    }

    return out;
  };

  const traverse = (node: any, visit: (obj: any) => void): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    visit(node);

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const value = (node as any)[keys[i]];
      if (value && typeof value === "object") {
        if (Array.isArray(value)) {
          for (let a = 0; a < value.length; a++) {
            traverse(value[a], visit);
          }
        } else {
          traverse(value, visit);
        }
      }
    }
  };

  return {
    buildRootSelectionKey,
    buildFieldSelectionKey,
    compileSelections,
  };
};
