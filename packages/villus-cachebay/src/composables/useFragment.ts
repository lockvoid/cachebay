// src/composables/useFragment.ts
import { ref, unref, watchEffect, type Ref } from "vue";
import { parse, Kind, type FragmentDefinitionNode } from "graphql";
import { useCache } from "./useCache";

export type UseFragmentParams = {
  /** Canonical entity key like "User:1" (or a Ref<string>) */
  id: string | Ref<string>;
  /** GraphQL fragment source (single fragment) — validated & parsed */
  fragment: string;
};

/**
 * useFragment (LIVE)
 * - Returns a Ref holding a *live* entity proxy (reactive).
 * - Immediate: materializes on first run.
 * - If the entity isn't present yet, the proxy still exists and will be populated by later writes.
 * - If `id` is a Ref and changes, the returned Ref updates to point to the new entity proxy.
 *
 * Notes:
 * - This hook *validates* the fragment (must be a single fragment), but doesn't use it to
 *   build snapshots — live proxies come from the graph store directly.
 * - For snapshot reads, use readFragment() from the fragments API instead.
 */
export function useFragment(params: UseFragmentParams): Ref<any | null> {
  // Validate inputs early
  if (!params || typeof params !== "object") {
    throw new Error("[useFragment] params must be an object");
  }
  const fragSrc = params.fragment;
  if (typeof fragSrc !== "string" || fragSrc.trim() === "") {
    throw new Error("[useFragment] `fragment` must be a non-empty string");
  }

  // Parse & validate: must contain exactly one fragment definition
  let fragmentDef: FragmentDefinitionNode | undefined;
  try {
    const doc = parse(fragSrc);
    fragmentDef = doc.definitions.find(
      (d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION
    );
    if (!fragmentDef) {
      throw new Error("no fragment definition");
    }
  } catch {
    throw new Error("[useFragment] `fragment` must contain a single valid fragment definition");
  }

  // Grab cache instance; we *require* materializeEntity for live data
  const cache = useCache() as any;
  if (typeof cache.materializeEntity !== "function") {
    throw new Error("[useFragment] cache instance does not expose materializeEntity()");
  }

  const data = ref<any | null>(null);

  // Immediate & reactive to id changes
  watchEffect(() => {
    const key = unref(params.id);
    if (!key || typeof key !== "string") {
      data.value = null;
      return;
    }
    // Live proxy from the graph (reactive); later writes will flow through
    data.value = cache.materializeEntity(key);
  });

  return data;
}
