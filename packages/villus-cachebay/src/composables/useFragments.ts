import { shallowRef, onScopeDispose, getCurrentScope } from "vue";
import { useCache } from "./useCache";

export function useFragments<T = any>(
  pattern: string | string[],
  opts: { materialized?: boolean } = {}
) {
  const { readFragments, registerEntityWatcher, unregisterEntityWatcher, trackEntity,
    registerTypeWatcher, unregisterTypeWatcher } = useCache() as any;

  const materialized = opts.materialized !== false;
  const out = shallowRef<T[]>([]);
  let wid: number | null = null;

  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  const wildcardTypes = patterns
    .filter((p) => typeof p === 'string' && p.endsWith(':*'))
    .map((p) => p.slice(0, -2));

  // membership signature
  let lastKeysSig = "";

  // Track type-level subscriptions for wildcard patterns
  const typeWids: Array<{ t: string; id: number }> = [];

  function compute() {
    const list = readFragments(pattern, { materialized }) as T[];

    // build keys set for entity-level watchers
    const keys = new Set<string>();
    for (const it of list as any[]) {
      const t = it?.__typename;
      const id = it?.id;
      if (t && id != null) keys.add(`${t}:${String(id)}`);
    }
    const keysSig = Array.from(keys).sort().join(",");

    // (re)register key watcher for entity content changes
    if (wid == null) {
      wid = registerEntityWatcher(() => compute());
    }
    keys.forEach((k) => trackEntity(wid!, k));

    // ensure type watchers registered once
    if (typeWids.length === 0 && wildcardTypes.length) {
      for (const t of wildcardTypes) {
        const id = registerTypeWatcher(t, () => compute());
        typeWids.push({ t, id });
      }
    }

    if (materialized) {
      // replace array only when membership changed; proxies update in place
      if (keysSig !== lastKeysSig) {
        lastKeysSig = keysSig;
        out.value = list as any as T[];
      }
    } else {
      // snapshots: refresh on compute; you can keep identity when membership same,
      // but for clarity we replace on every compute (tests expect the value change).
      out.value = list.map((it: any) => (it ? structuredClone(it) : it)) as T[];
      lastKeysSig = keysSig;
    }
  }

  compute();

  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (wid != null) unregisterEntityWatcher(wid);
      for (const { t, id } of typeWids) unregisterTypeWatcher(t, id);
    });
  }

  return out;
}
