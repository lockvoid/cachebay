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

  function compute() {
    const list = readFragments(pattern, { materialized }) as T[];

    // register (or re-register) watcher for all typename:id in the list
    const keys = new Set<string>();
    for (const it of list as any[]) {
      const t = it?.__typename;
      const id = it?.id;
      if (t && id != null) keys.add(`${t}:${String(id)}`);
    }
    if (wid == null) {
      wid = registerWatcher(() => compute());
    }
    keys.forEach((k) => trackEntityDependency(wid!, k));

    out.value = materialized ? (list as any as T[]) : list.map((it: any) => (it ? structuredClone(it) : it));
  }

  compute();

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (wid != null) unregisterWatcher(wid);
    });
  }

  return out;
}
