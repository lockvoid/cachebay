import type { CachePlan } from "./types";

export const isCachePlan = (v: any): v is CachePlan => {
  return v && typeof v === "object" && v.kind === "CachePlan";
};
