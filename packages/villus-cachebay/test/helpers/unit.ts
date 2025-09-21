import { visit, Kind, type DocumentNode } from "graphql";

export const collectConnectionDirectives = (doc: DocumentNode): string[] => {
  const hits: string[] = [];
  visit(doc, {
    Field(node) {
      const hasConn = (node.directives || []).some(d => d.name.value === "connection");
      if (hasConn) hits.push(node.name.value);
    }
  });
  return hits;
};

export const selectionSetHasTypename = (node: any): boolean => {
  const ss = node?.selectionSet;
  if (!ss || !Array.isArray(ss.selections)) return false;
  return ss.selections.some((s: any) => s.kind === Kind.FIELD && s.name?.value === "__typename");
};

export const everySelectionSetHasTypename = (doc: DocumentNode): boolean => {
  let ok = true;
  visit(doc, {
    SelectionSet(node) {
      if (!selectionSetHasTypename({ selectionSet: node })) ok = false;
    }
  });
  return ok;
};
