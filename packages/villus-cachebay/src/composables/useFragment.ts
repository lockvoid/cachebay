import { shallowRef, isRef, watch, unref, onScopeDispose, getCurrentScope, type Ref } from "vue";
import { useCache } from "./useCache";

type UseFragmentMode = "auto" | "static" | "dynamic";
type UseFragmentOpts = { materialized?: boolean; mode?: UseFragmentMode };

function keyOf(input: any): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  const t = input.__typename;
  const id = input.id;
  return t && id != null ? `${t}:${String(id)}` : null;
}
function keySig(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const t = v.__typename;
  const id = v.id;
  return t && id != null ? `${t}:${id}` : JSON.stringify(v);
}

export function useFragment<T = any>(
  source:
    | string
    | { __typename: string; id?: any }
    | Ref<string | { __typename: string; id?: any } | null | undefined>,
  opts: UseFragmentOpts = {},
): Ref<T | undefined> | T | undefined {
  const { readFragment, registerEntityWatcher, unregisterEntityWatcher, trackEntity } = useCache();
  const materialized = opts.materialized !== false;
  const mode: UseFragmentMode = opts.mode ?? "auto";
  const dynamic = mode === "dynamic" || (mode === "auto" && isRef(source));

  if (!dynamic) {
    const input = unref(source) as any;
    if (!input) return undefined;
    if (materialized) {
      return readFragment(input, { materialized: true }) as T;
    }
    const snap = readFragment(input, { materialized: false }) as T;
    return snap ? structuredClone(snap) : snap;
  }

  const out = shallowRef<T | undefined>(undefined);
  let lastSig = "";
  let wid: number | null = null;
  let trackedKey: string | null = null;

  const stop = watch(
    () => unref(source) as any,
    (val) => {
      const sig = keySig(val);
      if (sig !== lastSig) {
        lastSig = sig;

        const k = keyOf(val);
        trackedKey = k;

        if (!materialized) {
          if (wid == null) {
            wid = registerEntityWatcher(() => {
              if (!trackedKey) return;
              const snap = val ? (readFragment(val, { materialized: false }) as any as T) : undefined;
              out.value = snap ? structuredClone(snap) : snap;
            });
          }
          if (trackedKey) trackEntity(wid, trackedKey);
        }

        if (materialized) {
          out.value = val ? (readFragment(val, { materialized: true }) as any as T) : undefined;
        } else {
          const snap = val ? (readFragment(val, { materialized: false }) as any as T) : undefined;
          out.value = snap ? structuredClone(snap) : snap;
        }
      }
    },
    { immediate: true }
  );

  // only register disposal if there is an active Vue scope (avoids test warnings)
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop();
      if (wid != null) unregisterEntityWatcher(wid);
    });
  }

  return out as Ref<T | undefined>;
}
