import type { DocumentNode } from "graphql";
import { compileToPlan, isCachePlanV1, type CachePlanV1 } from "@/src/compiler";

export type PlannerInstance = ReturnType<typeof createPlanner>;

export const createPlanner = () => {
  // AST → plan
  const docCache = new WeakMap<DocumentNode, CachePlanV1>();
  // string → plan
  const strCache = new Map<string, CachePlanV1>();

  const getPlan = (docOrPlan: DocumentNode | CachePlanV1 | string): CachePlanV1 => {
    // Already compiled? just return it
    if (isCachePlanV1(docOrPlan)) return docOrPlan;

    // String docs: use a normal Map
    if (typeof docOrPlan === "string") {
      const hit = strCache.get(docOrPlan);
      if (hit) return hit;
      const plan = compileToPlan(docOrPlan); // compileToPlan now accepts strings
      strCache.set(docOrPlan, plan);
      return plan;
    }

    // DocumentNode: use WeakMap
    const hit = docCache.get(docOrPlan);
    if (hit) return hit;
    const plan = compileToPlan(docOrPlan);
    docCache.set(docOrPlan, plan);
    return plan;
  };

  return { getPlan };
};
