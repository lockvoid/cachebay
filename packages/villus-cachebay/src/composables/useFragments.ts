import { shallowRef, onScopeDispose, getCurrentScope } from "vue";
import { useCache } from "./useCache";

export function useFragments<T = any>(
  pattern: string | string[],
  opts: { materialized?: boolean } = {}
) {
  const { readFragments, registerWatcher, unregisterWatcher, trackEntityDependency } = useCache();
  const materialized = opts.materialized !== false;

  const out = shallowRef<T[]>([]);
  let wid: number | null = null;

  // Track membership signature to avoid replacing the array
  let lastKeysSig = "";

  function compute() {
    const list = readFragments(pattern, { materialized }) as T[];

    // derive membership keys typename:id (ignore content)
    const keys = new Set<string>();
    for (const it of list as any[]) {
      const t = it?.__typename;
      const id = it?.id;
      if (t && id != null) keys.add(`${t}:${String(id)}`);
    }
    const keysSig = Array.from(keys).sort().join(",");

    // (re)register watcher
    if (wid == null) {
      wid = registerWatcher(() => compute());
    }
    keys.forEach((k) => trackEntityDependency(wid!, k));

    if (materialized) {
      // Only replace the array if membership changed
      if (keysSig !== lastKeysSig) {
        lastKeysSig = keysSig;
        out.value = list as any as T[];
      }
      // if membership unchanged: keep the array identity; proxies update in place
    } else {
      // For snapshots: always return cloned items, but only when membership changes
      if (keysSig !== lastKeysSig) {
        lastKeysSig = keysSig;
        out.value = list.map((it: any) => (it ? structuredClone(it) : it)) as T[];
      } else {
        // No membership change, but members may have changed → refresh snapshots
        out.value = list.map((it: any) => (it ? structuredClone(it) : it)) as T[];
      }
    }
  }

  compute();

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (wid != null) unregisterWatcher(wid);
    });
  }

  return out;
}
