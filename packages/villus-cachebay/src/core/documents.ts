import type { DocumentNode, OperationDefinitionNode, SelectionSetNode, FieldNode, ArgumentNode, ValueNode } from "graphql";
import type { GraphInstance } from "./graph";
import { isObject, hasTypename, traverseFast, stableStringify } from "./utils";

export type ConnectionOptions = {
  mode?: "infinite" | "page";
  args?: string[];
};

export type DocumentsOptions = {
  connections: Record<string, Record<string, ConnectionOptions>>;
};

export type DocumentsDependencies = {
  graph: GraphInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (config: DocumentsOptions, dependencies: DocumentsDependencies) => {
  const { graph } = dependencies;

  const normalizeDocument = ({ document, variables = {}, data }: { document: DocumentNode; variables?: Record<string, any>; data: any }) => {
    traverseFast(data, (node) => {
      // ...
    });
  }

  const denormalizeDocument = ({ document, variables = {} }: { document: DocumentNode; variables?: Record<string, any>; }) => {
    traverseFast(data, (node) => {
      // ...
    });
  }

  const materializeDocument = ({ document, variables = {} }: { document: DocumentNode; variables?: Record<string, any>; }) => {
    traverseFast(data, (node) => {
      // ...
    });
  }

  return {
    normalizeDocument,
    denormalizeDocument,
    materializeDocument,
  };
};
