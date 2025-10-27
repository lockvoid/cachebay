import type { CachePlan } from 'cachebay';

/**
 * Deserialize JavaScript code back to a CachePlan.
 * This is used for testing to verify serialization round-trips correctly.
 */
export function deserializePlan(code: string): CachePlan {
  // Evaluate the serialized code to get the plan object
  // eslint-disable-next-line no-eval
  const plan = eval(code) as CachePlan;
  
  return plan;
}
