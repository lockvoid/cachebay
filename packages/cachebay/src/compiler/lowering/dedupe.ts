import {
  Kind,
  type ArgumentNode,
  type ValueNode,
  type DirectiveNode,
  type FragmentDefinitionNode,
} from "graphql";
import { TYPENAME_FIELD } from "../constants";

/* ────────────────────────────────────────────────────────────────────────── */
/* Signature builders (lazy, fast)                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Build a stable signature for a value AST node.
 * For variables, we use the variable name (not runtime value).
 */
const valueSignature = (value: ValueNode): string => {
  switch (value.kind) {
    case Kind.VARIABLE:
      return `$${value.name.value}`;
    case Kind.INT:
    case Kind.FLOAT:
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.ENUM:
      return String(value.value);
    case Kind.NULL:
      return "null";
    case Kind.LIST:
      return `[${value.values.map(valueSignature).join(",")}]`;
    case Kind.OBJECT: {
      const fields = value.fields
        .slice()
        .sort((a, b) => a.name.value.localeCompare(b.name.value))
        .map(f => `${f.name.value}:${valueSignature(f.value)}`)
        .join(",");
      return `{${fields}}`;
    }
    default:
      return "";
  }
};

/**
 * Build a stable signature for argument AST (structural, based on variable names).
 * This is compile-time only - we compare AST structure, not runtime values.
 * Fast path: returns "" for empty args without allocations.
 */
const buildArgSignature = (args: readonly ArgumentNode[] | undefined): string => {
  // Fast path: no args
  if (!args || args.length === 0) return "";
  
  // Single arg: skip sort
  if (args.length === 1) {
    const arg = args[0];
    return `${arg.name.value}:${valueSignature(arg.value)}`;
  }
  
  // Multiple args: sort for stability
  const sorted = args.slice().sort((a, b) => a.name.value.localeCompare(b.name.value));
  const parts: string[] = [];
  
  for (let i = 0; i < sorted.length; i++) {
    const arg = sorted[i];
    parts.push(`${arg.name.value}:${valueSignature(arg.value)}`);
  }
  
  return parts.join(",");
};

/**
 * Build a stable signature for directive set (name + args).
 * Fast path: returns "" for empty directives without allocations.
 */
const buildDirectiveSignature = (directives: readonly DirectiveNode[] | undefined): string => {
  // Fast path: no directives
  if (!directives || directives.length === 0) return "";
  
  // Single directive: skip sort
  if (directives.length === 1) {
    const dir = directives[0];
    const argSig = buildArgSignature(dir.arguments);
    return argSig ? `@${dir.name.value}(${argSig})` : `@${dir.name.value}`;
  }
  
  // Multiple directives: sort for stability
  const sorted = directives.slice().sort((a, b) => a.name.value.localeCompare(b.name.value));
  const parts: string[] = [];
  
  for (let i = 0; i < sorted.length; i++) {
    const dir = sorted[i];
    const argSig = buildArgSignature(dir.arguments);
    parts.push(argSig ? `@${dir.name.value}(${argSig})` : `@${dir.name.value}`);
  }
  
  return parts.join(";");
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Dedupe context and types                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

type ArgSig = string;
type DirSig = string;

type DedupeCtx = {
  getArgSig: (args: readonly any[] | undefined) => ArgSig;
  getDirectiveSig: (dirs: readonly any[] | undefined) => DirSig;
  getFragmentDef: (name: string) => { typeCondition?: { name: { value: string } }, selections: any[] } | undefined;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Main dedupe logic (optimized: no sorting, lazy signatures, insertion order)*/
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Deduplicate one selection set:
 * - Fields: merge sub-selections (union) when responseKey + argSig + dirSig match.
 * - Inline fragments: merge by (typeCondition + dirSig).
 * - Fragment spreads: drop exact duplicates by (name + dirSig).
 * Deterministic via input/insertion order (no sorts).
 */
export const dedupeSelectionSet = (selections: readonly any[], parentType: string, ctx: DedupeCtx): any[] => {
  const fields = new Map<string, any>();
  const inlines = new Map<string, any>();
  const spreads = new Map<string, any>();

  const out: any[] = [];

  // Small helpers (lazy, fast)
  const responseKeyOf = (field: any): string => field.alias ? field.alias.value : field.name.value;
  const fieldKeyOf = (field: any): string => {
    const responseKey = responseKeyOf(field);
    const argSig = ctx.getArgSig(field.arguments);
    const storageKey = field.name.value + "(" + argSig + ")";
    const dirSig = ctx.getDirectiveSig(field.directives);
    // No parent in key: dedupeSelectionSet is always called per parent type
    return responseKey + "|" + storageKey + "|" + dirSig;
  };
  const inlineKeyOf = (inline: any): string => {
    const on = inline.typeCondition?.name?.value || parentType;
    const dirSig = ctx.getDirectiveSig(inline.directives);
    return on + "|" + dirSig;
  };
  const spreadKeyOf = (spread: any): string => {
    const name = spread.name.value;
    const dirSig = ctx.getDirectiveSig(spread.directives);
    // If you add fragment arguments, include a structural fragArgSig here
    return name + "|" + dirSig;
  };

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const kind = sel.kind;

    if (kind === "Field") {
      // Preserve __typename position: push first seen inline, skip subsequent
      if (sel.name.value === TYPENAME_FIELD) {
        if (!out.some(s => s.kind === "Field" && s.name.value === TYPENAME_FIELD)) {
          out.push(sel);
        }
        continue;
      }

      const key = fieldKeyOf(sel);
      const prev = fields.get(key);

      if (!prev) {
        fields.set(key, sel);
      } else {
        // Merge sub-selections only if both have any
        const a = prev.selectionSet?.selections;
        const b = sel.selectionSet?.selections;
        if (a && a.length) {
          if (b && b.length) {
            prev.selectionSet = {
              kind: "SelectionSet",
              selections: dedupeSelectionSet(a.concat(b), parentType, ctx),
            };
          }
          // else keep prev (already has richer sub-selection)
        } else if (b && b.length) {
          // prev was scalar, current has sub-selection → upgrade to richer one
          prev.selectionSet = {
            kind: "SelectionSet",
            selections: dedupeSelectionSet(b, parentType, ctx),
          };
        }
      }
      continue;
    }

    if (kind === "InlineFragment") {
      const key = inlineKeyOf(sel);
      const prev = inlines.get(key);

      if (!prev) {
        inlines.set(key, sel);
      } else {
        const a = prev.selectionSet?.selections || [];
        const b = sel.selectionSet?.selections || [];
        if (b.length) {
          prev.selectionSet = {
            kind: "SelectionSet",
            selections: dedupeSelectionSet(a.concat(b), sel.typeCondition?.name?.value || parentType, ctx),
          };
        }
      }
      continue;
    }

    if (kind === "FragmentSpread") {
      const key = spreadKeyOf(sel);
      if (!spreads.has(key)) {
        spreads.set(key, sel);
      }
      continue;
    }

    // Unknown node kinds are ignored (keeps code small and safe)
  }

  // Preserve insertion order (Map remembers it).
  for (const [, field] of fields) {
    // Ensure inner selections are deduped exactly once (skip if 0 or 1 selection)
    const inner = field.selectionSet?.selections;
    if (inner && inner.length > 1) {
      field.selectionSet = {
        kind: "SelectionSet",
        selections: dedupeSelectionSet(inner, parentType, ctx),
      };
    }
    out.push(field);
  }

  for (const [, spread] of spreads) {
    out.push(spread);
  }

  for (const [, inline] of inlines) {
    const onType = inline.typeCondition?.name?.value || parentType;
    const inner = inline.selectionSet?.selections || [];
    // Skip dedupe if 0 or 1 selection
    if (inner.length > 1) {
      inline.selectionSet = { kind: "SelectionSet", selections: dedupeSelectionSet(inner, onType, ctx) };
    }
    out.push(inline);
  }

  return out;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Document-level dedupe (operations + fragments)                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Dedupe all selection sets in a document (operations and fragments).
 * This is the top-level entry point called during compilation.
 */
export const dedupeDocument = (
  doc: { definitions: readonly any[] },
  fragmentsByName: Map<string, FragmentDefinitionNode>,
): { definitions: readonly any[] } => {
  const ctx: DedupeCtx = {
    getArgSig: buildArgSignature,
    getDirectiveSig: buildDirectiveSignature,
    getFragmentDef: (name: string) => fragmentsByName.get(name),
  };
  
  const newDefinitions: any[] = [];
  const seenFragments = new Set<string>();
  
  for (let i = 0; i < doc.definitions.length; i++) {
    const def = doc.definitions[i];
    
    // Operation
    if (def.kind === Kind.OPERATION_DEFINITION) {
      const rootTypename = 
        def.operation === "mutation" ? "Mutation" :
        def.operation === "subscription" ? "Subscription" :
        "Query";
      
      const dedupedSels = dedupeSelectionSet(
        def.selectionSet.selections,
        rootTypename,
        ctx,
      );
      
      newDefinitions.push({
        ...def,
        selectionSet: { kind: "SelectionSet", selections: dedupedSels },
      });
      continue;
    }
    
    // Fragment
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      const fragmentName = def.name.value;
      
      // Skip duplicate fragment definitions
      if (seenFragments.has(fragmentName)) {
        continue;
      }
      seenFragments.add(fragmentName);
      
      const parentTypename = def.typeCondition.name.value;
      
      const dedupedSels = dedupeSelectionSet(
        def.selectionSet.selections,
        parentTypename,
        ctx,
      );
      
      newDefinitions.push({
        ...def,
        selectionSet: { kind: "SelectionSet", selections: dedupedSels },
      });
      continue;
    }
    
    // Other definitions (schema, etc.) - pass through
    newDefinitions.push(def);
  }
  
  return {
    ...doc,
    definitions: newDefinitions,
  };
};
