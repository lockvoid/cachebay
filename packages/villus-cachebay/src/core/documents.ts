import type { GraphInstance } from "./graph";
import { isObject, hasTypename, traverseFast, stableStringify, TRAVERSE_SKIP } from "./utils";
export { compileToPlan, isCachePlanV1 } from "@/src/compiler";
import { IDENTITY_FIELDS } from "./constants";
import type { ArgBuilder, PlanField, CachePlanV1 } from "@/src/compiler";

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
    graph.putRecord("@", { id: "@", __typename: "@" });

    traverseFast(data, (parentNode, valueNode, fieldKey) => {

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
