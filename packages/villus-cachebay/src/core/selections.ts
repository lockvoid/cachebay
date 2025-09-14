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
export function createSelections({
  config,
  dependencies,
}: {
  config?: SelectionsConfig;
  dependencies: Deps;
}) {
  const { graph } = dependencies;

  function buildRootSelectionKey(field: string, args?: Record<string, any>): string {
    const a = args ? stableStringify(args) : "{}";
    return `${field}(${a})`;
  }

  function buildFieldSelectionKey(
    parentEntityKey: string,
    field: string,
    args?: Record<string, any>
  ): string {
    const a = args ? stableStringify(args) : "{}";
    return `${parentEntityKey}.${field}(${a})`;
  }

  /**
   * Heuristically emits:
   * - one root selection key per top-level field in `data`
   * - for every entity inside, any field shaped like a "connection"
   *   (object containing `edges` array AND `pageInfo` object)
   */
  function compileSelections(input: { data: any }): Array<{ key: string; subtree: any }> {
    const out: Array<{ key: string; subtree: any }> = [];
    const root = input.data;
    if (!root || typeof root !== "object") return out;

    // 1) root fields
    for (const f of Object.keys(root)) {
      const subtree = (root as any)[f];
      out.push({ key: buildRootSelectionKey(f, {}), subtree });

      // 2) nested “connection-like” fields keyed by parent entity
      traverse(subtree, (parent) => {
        const pKey = graph.identify(parent);
        if (!pKey) return;

        for (const k of Object.keys(parent)) {
          const v = (parent as any)[k];
          if (v && typeof v === "object" && Array.isArray((v as any).edges) && (v as any).pageInfo) {
            out.push({ key: buildFieldSelectionKey(pKey, k, {}), subtree: v });
          }
        }
      });
    }
    return out;
  }

  function traverse(node: any, fn: (obj: any) => void) {
    if (!node || typeof node !== "object") return;
    fn(node);
    for (const k of Object.keys(node)) {
      const v = (node as any)[k];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) traverse(v[i], fn);
        } else {
          traverse(v, fn);
        }
      }
    }
  }

  return {
    buildRootSelectionKey,
    buildFieldSelectionKey,
    compileSelections,
  };
}
