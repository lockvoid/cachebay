import objectHash from 'object-hash';
import { visit, Kind, parse, print, type DocumentNode } from "graphql";
import { isRef, isReactive, toRaw } from "vue";
import type { EntityKey, RelayOptions } from "./types";
import { QUERY_ROOT } from "./constants";

/* ────────────────────────────────────────────────────────────────────────────
 * GraphQL AST utils (robust to non-AST inputs for tests)
 * ──────────────────────────────────────────────────────────────────────────── */

const TYPENAME_FIELD_NODE = {
  kind: Kind.FIELD,
  name: { kind: Kind.NAME, value: "__typename" },
} as const;

const DOCUMENT_CACHE = new WeakMap<DocumentNode, DocumentNode>();
const STRING_DOCUMENT_CACHE = new Map<string, DocumentNode>();
const PRINT_CACHE = new WeakMap<DocumentNode, string>();

function isDocumentNode(v: any): v is DocumentNode {
  return !!v && typeof v === "object" && v.kind === Kind.DOCUMENT;
}

/** Add __typename to all selection sets (except operation roots). */
function addTypename(doc: DocumentNode): DocumentNode {
  return visit(doc, {
    SelectionSet(node, _key, parent: any) {
      if (node.selections?.some((sel) => sel.kind === Kind.FIELD && (sel as any).name?.value === "__typename")) {
        return;
      }
      if (parent && parent.kind === Kind.OPERATION_DEFINITION) {
        return;
      }
      return { ...node, selections: [...node.selections, TYPENAME_FIELD_NODE as any] };
    },
  });
}

/**
 * Ensure a query has __typename; tolerant to anything (string/DocumentNode/other).
 * - string: parse → add → cache
 * - DocumentNode: add → cache
 * - anything else: return as-is
 */
export function ensureDocumentHasTypenameSmart(query: any): any {
  try {
    if (typeof query === "string") {
      const cached = STRING_DOCUMENT_CACHE.get(query);
      if (cached) return cached;
      const parsed = parse(query);
      const withTypename = addTypename(parsed);
      STRING_DOCUMENT_CACHE.set(query, withTypename);
      return withTypename;
    }
    if (isDocumentNode(query)) {
      const cached = DOCUMENT_CACHE.get(query);
      if (cached) return cached;
      const withTypename = addTypename(query);
      DOCUMENT_CACHE.set(query, withTypename);
      return withTypename;
    }
    return query;
  } catch {
    return query;
  }
}

/**
 * Get operation body as a stable string.
 * - string: returned
 * - DocumentNode: use loc.source.body if present, else print()
 * - anything else: JSON.stringify fallback (avoids `Invalid AST Node` in tests)
 */
export function getOperationBody(query: any): string {
  try {
    if (typeof query === "string") return query;

    if (isDocumentNode(query)) {
      const loc = (query as any)?.loc?.source?.body;
      if (loc) return loc;
      const cached = PRINT_CACHE.get(query);
      if (cached) return cached;
      const body = print(query);
      PRINT_CACHE.set(query, body);
      return body;
    }

    return JSON.stringify(query ?? "");
  } catch {
    return "";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Variable signatures / hashing
 * ──────────────────────────────────────────────────────────────────────────── */

const VAR_SIG = new WeakMap<object, Map<string, string>>();

export function stableIdentityExcluding(
  vars: Record<string, any>,
  remove: string[],
): string {
  if (!vars || typeof vars !== "object") return "";
  const removeKey = remove.length ? remove.slice().sort().join(",") : "";
  const perObj = VAR_SIG.get(vars as any);
  if (perObj && perObj.has(removeKey)) return perObj.get(removeKey)!;

  const exclude = new Set(remove);
  const filtered: Record<string, any> = {};
  const keys = Object.keys(vars).sort();
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (exclude.has(k)) continue;
    const v = (vars as any)[k];
    if (v == null) continue;
    filtered[k] = v;
  }

  const sig = objectHash(filtered, { unorderedObjects: true });

  if (perObj) {
    perObj.set(removeKey, sig);
  } else {
    const map = new Map<string, string>();
    map.set(removeKey, sig);
    VAR_SIG.set(vars as any, map);
  }
  return sig;
}

export const buildStableVariableString = (vars: Record<string, any>) =>
  stableIdentityExcluding(vars || {}, []);

/* ────────────────────────────────────────────────────────────────────────────
 * Safe object path read
 * ──────────────────────────────────────────────────────────────────────────── */

export function readPathValue(obj: any, path: string | string[]) {
  const segs = Array.isArray(path) ? path : path.split(".");
  let current = obj;
  for (let i = 0; i < segs.length; i++) {
    if (current == null) return undefined;
    current = current[segs[i]];
  }
  return current;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entity / connection keys
 * ──────────────────────────────────────────────────────────────────────────── */

const ROOT_TYPENAMES = new Set(['Query', 'Mutation', 'Subscription']);

export function parseEntityKey(
  key: string,
): { typename: string | null; id: string | null } {
  if (!key) return { typename: null, id: null };

  const idx = key.indexOf(":");
  if (idx === -1) {
    return ROOT_TYPENAMES.has(key) ? { typename: key, id: null } : { typename: null, id: null };
  }
  if (idx === 0) {
    const id = key.slice(1);
    return { typename: null, id: id || null };
  }
  const typename = key.slice(0, idx);
  const idPart = key.slice(idx + 1);
  return { typename, id: idPart || null };
}

export function buildConnectionKey(
  parent: string,
  field: string,
  opts: RelayOptions,
  vars: Record<string, any>,
): string {
  const id = stableIdentityExcluding(vars || {}, [
    opts.cursors.after,
    opts.cursors.before,
    opts.cursors.first,
    opts.cursors.last,
  ]);
  return `${parent}.${field}(${id})`;
}

export function normalizeParentKeyInput(
  parent: "Query" | { __typename: string; id?: any },
) {
  if (parent === "Query") return "Query";
  const t = (parent as any).__typename;
  const id = (parent as any).id;
  return t && id != null ? `${t}:${id}` : null;
}

export function parseVariablesFromConnectionKey(
  ckey: string,
  prefix: string,
): Record<string, any> | null {
  if (!ckey.startsWith(prefix) || ckey.charAt(ckey.length - 1) !== ")") return null;
  const inside = ckey.slice(prefix.length, ckey.length - 1);
  const vars: Record<string, any> = {};
  if (!inside) return vars;
  if (inside.indexOf(':') === -1) return vars;
  const parts = inside.split("|");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const k = part.slice(0, idx);
    const json = part.slice(idx + 1);
    try { (vars as any)[k] = JSON.parse(json); } catch { }
  }
  return vars;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Operation keys
 * ──────────────────────────────────────────────────────────────────────────── */

export function getFamilyKey(op: { query: any; variables: Record<string, any>, context?: { concurrencyScope?: string } }) {
  const body = getOperationBody(op.query);
  return `${body}::${op.context?.concurrencyScope || 'default'}`;
}

export function getOperationKey(op: { query: any; variables: Record<string, any> }) {
  const body = getOperationBody(op.query);
  return `${body}::${buildStableVariableString(op.variables || {})}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Misc helpers
 * ──────────────────────────────────────────────────────────────────────────── */

export function isObservableLike(v: any): v is { subscribe: Function } {
  return !!v && typeof v.subscribe === "function";
}

export const toSig = (data: any) => {
  try { return JSON.stringify(data); } catch { return ""; }
};

export const cleanVars = (vars: Record<string, any> | undefined | null) => {
  const out: Record<string, any> = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of Object.keys(vars)) {
    const v = (vars as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
};

export const viewRootOf = (root: any) => {
  if (!root || typeof root !== "object") return root;
  return Array.isArray(root) ? root.slice() : { ...root };
};

export function toPlainDeep(x: any) {
  try { return JSON.parse(JSON.stringify(x)); } catch { return x; }
}

export const unwrapShallow = (value: any): any => {
  return isRef(value) || isReactive(value) ? toRaw(value) : value;
};

export const getEntityParentKey = (typename: string, id?: any): EntityKey | null => {
  return typename === QUERY_ROOT ? QUERY_ROOT : id == null ? null : (typename + ":" + String(id)) as EntityKey;
};
