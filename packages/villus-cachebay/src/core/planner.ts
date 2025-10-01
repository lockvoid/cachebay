import { compilePlan, isCachePlanV1, type CachePlanV1 } from "../compiler";
import type { DocumentNode } from "graphql";

export type PlannerInstance = ReturnType<typeof createPlanner>;

type GetPlanOpts = { fragmentName?: string };

export const createPlanner = () => {
  // Cache for DocumentNode → (fragmentName|"" → plan)
  const docCache = new WeakMap<DocumentNode, Map<string, CachePlanV1>>();
  // Cache for string docs → key = doc + "::" + fragmentName
  const strCache = new Map<string, CachePlanV1>();

  const getPlan = (
    docOrPlan: DocumentNode | CachePlanV1 | string,
    opts?: GetPlanOpts,
  ): CachePlanV1 => {
    // Already compiled? just return it
    if (isCachePlanV1(docOrPlan)) return docOrPlan as CachePlanV1;

    const fragKey = opts?.fragmentName ?? "";

    if (typeof docOrPlan === "string") {
      const key = `${docOrPlan}::${fragKey}`;
      const hit = strCache.get(key);
      if (hit) return hit;

      const plan = compilePlan(docOrPlan, opts ?? {});
      strCache.set(key, plan);
      return plan;
    }

    // DocumentNode path
    let inner = docCache.get(docOrPlan);
    if (!inner) {
      inner = new Map<string, CachePlanV1>();
      docCache.set(docOrPlan, inner);
    }

    const hit = inner.get(fragKey);
    if (hit) return hit;

    const plan = compilePlan(docOrPlan, opts ?? {});
    inner.set(fragKey, plan);
    return plan;
  };

  return { getPlan };
};
