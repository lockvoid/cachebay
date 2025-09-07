import objectHash from 'object-hash';
import { visit, Kind, parse, print, type DocumentNode } from "graphql";
import type { RelayOptions } from "./types";

const TYPENAME_FIELD_NODE = {
  kind: Kind.FIELD,
  name: { kind: Kind.NAME, value: "__typename" },
} as const;

const DOCUMENT_CACHE = new WeakMap<DocumentNode, DocumentNode>();
const STRING_DOCUMENT_CACHE = new Map<string, DocumentNode>();
const PRINT_CACHE = new WeakMap<DocumentNode, string>();

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

export function ensureDocumentHasTypenameSmart(query: string | DocumentNode): DocumentNode {
  if (typeof query === "string") {
    const cached = STRING_DOCUMENT_CACHE.get(query);
    if (cached) {
      return cached;
    }
    const parsed = parse(query);
    const withTypename = addTypename(parsed);
    STRING_DOCUMENT_CACHE.set(query, withTypename);
    return withTypename;
  }
  const cached = DOCUMENT_CACHE.get(query);
  if (cached) {
    return cached;
  }
  const withTypename = addTypename(query);
  DOCUMENT_CACHE.set(query, withTypename);
  return withTypename;
}

export function getOperationBody(query: string | DocumentNode): string {
  if (typeof query === "string") {
    return query;
  }
  const loc = (query as any)?.loc?.source?.body;
  if (loc) {
    return loc;
  }
  const cached = PRINT_CACHE.get(query);
  if (cached) {
    return cached;
  }
  const body = print(query);
  PRINT_CACHE.set(query, body);
  return body;
}

/** Stable signature for variables (optionally excluding keys). */
const VAR_SIG = new WeakMap<object, Map<string, string>>();

export function stableIdentityExcluding(
  vars: Record<string, any>,
  remove: string[],
): string {
  // Produce a stable, order-independent identity for variables (deep).
  // Uses object-hash so nested object key order doesn't affect the signature.
  if (!vars || typeof vars !== "object") return "";
  const removeKey = remove.length ? remove.slice().sort().join(",") : "";
  const perObj = VAR_SIG.get(vars as any);
  if (perObj && perObj.has(removeKey)) return perObj.get(removeKey)!;

  // Build filtered shallow copy (we purposely don't clone deeply to keep cost low;
  // object-hash will traverse the structure).
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

  // Signature: a short hash string (hex) that is stable across key order.
  // We prefer unorderedObjects so {a:1,b:2} === {b:2,a:1}.
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

/** Safe object path reader for dot-or-array paths. */
export function readPathValue(obj: any, path: string | string[]) {
  const segs = Array.isArray(path) ? path : path.split(".");
  let current = obj;
  for (let i = 0; i < segs.length; i++) {
    if (current == null) {
      return undefined;
    }
    const seg = segs[i];
    current = current[seg];
  }
  return current;
}

/** Parse "Type:id" keys. */
export function parseEntityKey(
  key: string,
): { typename: string | null; id: string | null } {
  const idx = key.indexOf(":");
  if (idx <= 0) return { typename: null, id: null };
  return { typename: key.slice(0, idx), id: key.slice(idx + 1) };
}

/** Build a connection storage key from parent/field/relay options/variables. */
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
  return parent + "." + field + "(" + id + ")";
}

/** Normalize parent ref to entity key string. */
export function normalizeParentKeyInput(
  parent: "Query" | { __typename: string; id?: any; _id?: any },
) {
  if (parent === "Query") return "Query";
  const t = (parent as any).__typename;
  const id = (parent as any).id ?? (parent as any)._id;
  return t && id != null ? `${t}:${id}` : null;
}

/** Attempt to parse variables back from a connection key (legacy string format only). */
export function parseVariablesFromConnectionKey(
  ckey: string,
  prefix: string,
): Record<string, any> | null {
  if (!ckey.startsWith(prefix) || ckey.charAt(ckey.length - 1) !== ")") return null;
  const inside = ckey.slice(prefix.length, ckey.length - 1);
  const vars: Record<string, any> = {};
  if (!inside) return vars;
  if (inside.indexOf(':') === -1) { return vars; } // hashed signature cannot be parsed back
  const parts = inside.split("|");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const k = part.slice(0, idx);
    const json = part.slice(idx + 1);
    try {
      (vars as any)[k] = JSON.parse(json);
    } catch {
      /* ignore malformed */
    }
  }
  return vars;
}

/** Identify a "family" of operations (query body + optional concurrency scope). */
export function familyKeyForOperation(op: any) {
  const body = getOperationBody(op.query);
  const scope = op.context?.concurrencyScope ?? op.context?.cachebayScope;
  return scope ? `${body}::${scope}` : body;
}

/** Unique key for an operation instance (body + full variables). */
export function operationKey(op: { query: any; variables: Record<string, any> }) {
  const body = getOperationBody(op.query);
  return body + "::" + buildStableVariableString(op.variables || {});
}

/** Tiny type guard for observable-like values (subscriptions). */
export function isObservableLike(v: any): v is { subscribe: Function } {
  return !!v && typeof v.subscribe === "function";
}
