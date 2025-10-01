import type { CachePlanV1 } from "./types";

export const isCachePlanV1 = (v: any): v is CachePlanV1 => {
  return v && typeof v === "object" && v.kind === "CachePlanV1";
};
