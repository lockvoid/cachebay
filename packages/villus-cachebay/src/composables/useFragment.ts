/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref, unref, type Ref } from "vue";
import { useCache } from "./useCache";

export type UseFragmentParams = {
  /** Canonical entity key like "User:1" (or a Ref of it) */
  id: string | Ref<string>;
  /** GraphQL fragment text (same string you pass to writeFragment/readFragment) */
  fragment: string;
  /** Optional variables (or a Ref of variables) used in the fragment */
  variables?: Record<string, any> | Ref<Record<string, any> | undefined>;
  /** If true, materialize proxies in the returned data (defaults to true) */
  materialized?: boolean;
  /** If false, don’t read immediately; call `read()` manually (defaults to true) */
  immediate?: boolean;
};

export function useFragment<T = any>(params: UseFragmentParams) {
  const cache = useCache();

  const data = ref<T | null>(null);

  const read = () => {
    const key = unref(params.id);
    const vars = params.variables ? unref(params.variables) : undefined;
    const materialized = params.materialized !== false;

    const result = cache.readFragment({
      id: key,
      fragment: params.fragment,
      variables: vars,
    });

    data.value = materialized ? (result as T) : (result as T);
    return data.value;
  };

  const write = (payload: any) => {
    const key = unref(params.id);
    const vars = params.variables ? unref(params.variables) : undefined;

    cache.writeFragment({
      id: key,
      fragment: params.fragment,
      data: payload,
      variables: vars,
    });
  };

  if (params.immediate !== false) {
    // fire a single sync read
    read();
  }

  return {
    /** current fragment view (reactive) */
    data,
    /** re-read the fragment (use if id/variables changed) */
    read,
    /** write a partial/subtree matching the fragment into the cache */
    write,
  };
}
