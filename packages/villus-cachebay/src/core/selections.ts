import { stableStringify } from './utils';

// src/core/selections.ts

type SelectionsConfig = {
  // future options (e.g., key formatters) can go here
};

type Deps = {
  identify: (obj: any) => string | null;
  stableStringify: (v: any) => string;
};

export type SelectionsAPI = ReturnType<typeof createSelections>;

/**
 * Selection helpers: build stable selection keys and (optionally)
 * derive several selection entries from a payload subtree (heuristic).
 *
 * NOTE: You can replace compileSelections with a real GraphQL AST compiler later.
 */
export function createSelections({
  config,
  dependencies,
}: {
  config?: SelectionsConfig;
  dependencies: Deps;
}) {
  const { identify } = dependencies;

  function buildRootSelectionKey(field: string, args?: Record<string, any>): string {
    const a = args ? stableStringify(args) : "{}";
    return `${field}(${a})`;
  }

  function buildFieldSelectionKey(parentEntityKey: string, field: string, args?: Record<string, any>): string {
    const a = args ? stableStringify(args) : "{}";
    return `${parentEntityKey}.${field}(${a})`;
  }

  function compileSelections(input: { data: any }): Array<{ key: string; subtree: any }> {
    const out: Array<{ key: string; subtree: any }> = [];
    const root = input.data;
    if (!root || typeof root !== "object") return out;

    for (const f of Object.keys(root)) {
      const subtree = root[f];
      out.push({ key: buildRootSelectionKey(f, {}), subtree });

      // walk subtree to emit "connection-like" selections tied to parent entities
      traverse(subtree, (parent) => {
        const pKey = identify(parent);
        if (!pKey) return;
        for (const k of Object.keys(parent)) {
          const v = parent[k];
          if (v && typeof v === "object" && Array.isArray(v.edges) && v.pageInfo) {
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
      const v = node[k];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) v.forEach((it) => traverse(it, fn));
        else traverse(v, fn);
      }
    }
  }

  return {
    buildRootSelectionKey,
    buildFieldSelectionKey,
    compileSelections,
  };
}
