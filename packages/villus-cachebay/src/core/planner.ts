import type { DocumentNode } from "graphql";
import { compileToPlan, isCachePlanV1, type CachePlanV1 } from "@/src/compiler";

export type PlannerOptions = {
  connections?: Record<string, Record<string, { mode?: "infinite" | "page"; args?: string[] }>>;
};

export type PlannerInstance = ReturnType<typeof createPlanner>;

/**
 * Shared plan cache for operations & fragments.
 * One instance per app (or per graph env) is typical.
 */
export const createPlanner = (options: PlannerOptions = {}) => {
  const planCache = new WeakMap<DocumentNode, CachePlanV1>();

  const getPlan = (docOrPlan: DocumentNode | CachePlanV1): CachePlanV1 => {
    if (isCachePlanV1(docOrPlan)) return docOrPlan;

    const hit = planCache.get(docOrPlan);
    if (hit) return hit;

    const plan = compileToPlan(docOrPlan, { connections: options.connections || {} });

    planCache.set(docOrPlan, plan);

    return plan;
  };

  const clear = () => {
    planCache.clear();
  };

  return { getPlan, clear };
};
