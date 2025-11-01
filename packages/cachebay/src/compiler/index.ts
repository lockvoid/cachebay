export type { PlanField, CachePlan } from "./types";
export { isCachePlan } from "./utils";
export { compilePlan } from "./compile";
export { dedupeDocument, dedupeSelectionSet } from "./lowering/dedupe";
export * from "./utils";
