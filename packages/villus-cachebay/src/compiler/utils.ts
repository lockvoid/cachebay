export const isCachePlanV1 = (v: any): v is CachePlanV1 => {
  return v && typeof v === "object" && v.__kind === "CachePlanV1";
}
