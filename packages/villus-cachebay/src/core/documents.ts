import { ROOT_ID } from "./constants";
import { isObject, hasTypename, traverseFast, buildFieldKey, buildConnectionKey, buildConnectionCanonicalKey, upsertEntityShallow, TRAVERSE_SKIP } from "./utils";
import type { CachePlan, PlanField } from "../compiler";
import type { CanonicalInstance } from "./canonical";
import type { GraphInstance } from "./graph";
import type { PlannerInstance } from "./planner";
import type { ViewsInstance } from "./views";
import type { DocumentNode } from "graphql";

export type DocumentsDependencies = {
  graph: GraphInstance;
  planner: PlannerInstance;
  views: ViewsInstance;
  canonical: CanonicalInstance;
};

export type DocumentsInstance = ReturnType<typeof createDocuments>;

export const createDocuments = (deps: DocumentsDependencies) => {
  const { graph, views, planner, canonical } = deps;

  const normalizeDocument = ({
    document,
    variables = {},
    data,
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
    data: any;
  }) => {
    graph.putRecord(ROOT_ID, { id: ROOT_ID, __typename: ROOT_ID });

    const plan = planner.getPlan(document);

    const initialFrame = { parentId: ROOT_ID, fields: plan.root, fieldsMap: plan.rootSelectionMap };

    traverseFast(data, initialFrame, (parentNode, currentNode, responseKey, frame) => {
      const planField = frame.fieldsMap.get(responseKey);

      if (!planField) {
        return frame;
      }

      console.log(planField);

      console.log(currentNode);

      if (planField.isConnection) {

      }

      if (isObject(currentNode)) {
        console.log(frame.fields);
        // const identity = graph.identify(currentNode);
        //
        // if (identity === null) {
        //   return frame;
        // }
        //
        // graph.putRecord(identity, currentNode);
        //
        // graph.putRecord(identity, currentNode);
        //
        // return {
        //   parentNode: identity,
        // };
      }
    });
  };

  const materializeDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }) => {

  };

  const warmDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }) => {

  };

  const hasDocument = ({
    document,
    variables = {},
  }: {
    document: DocumentNode | CachePlan;
    variables?: Record<string, any>;
  }): boolean => {
    const plan = planner.getPlan(document);

    return true;
  };

  return {
    normalizeDocument,
    materializeDocument,
    warmDocument,
    hasDocument,
  };
};
