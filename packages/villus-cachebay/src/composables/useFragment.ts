import {
  inject,
  shallowRef,
  isRef,
  watch,
  computed,
  unref,
  type Ref,
  type App,
} from "vue";
import type { CachebayInstance } from "./core/internals";


/** useFragment… (unchanged) */
type UseFragmentMode = "auto" | "static" | "dynamic";
type UseFragmentOpts = { materialized?: boolean; mode?: UseFragmentMode; asObject?: boolean };

function keySig(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const t = v.__typename;
  const id = v.id ?? v._id;
  return t && id != null ? `${t}:${id}` : JSON.stringify(v);
}

export function useFragment<T = any>(
  source:
    | string
    | { __typename: string; id?: any; _id?: any }
    | Ref<string | { __typename: string; id?: any; _id?: any } | null | undefined>,
  opts: UseFragmentOpts = {},
): Ref<T | undefined> | T | undefined {
  const { readFragment } = useCache();
  const materialized = opts.materialized !== false;
  const mode: UseFragmentMode = opts.mode ?? "auto";
  const dynamic = mode === "dynamic" || (mode === "auto" && isRef(source));

  if (!dynamic) {
    const input = unref(source) as any;
    const proxy = input ? (readFragment(input, materialized) as any as T) : undefined;
    if (opts.asObject) return proxy;
    const out = shallowRef<T | undefined>(proxy);
    return out;
  }

  const out = shallowRef<T | undefined>(undefined);
  let last = "";

  watch(
    () => unref(source) as any,
    (val) => {
      const sig = keySig(val);
      if (sig !== last) {
        last = sig;
        out.value = val ? (readFragment(val, materialized) as any as T) : undefined;
      }
    },
    { immediate: true },
  );

  return out;
}
