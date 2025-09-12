import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 'vue' so we can control inject(); keep real reactivity
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  let _api: any = null;
  return {
    ...actual,
    inject: () => _api,
    __setInjectedApi: (api: any) => { _api = api; },
  } as any;
});

import * as Vue from 'vue';
import { useFragments } from '@/src/composables/useFragments';

describe('useFragments with graph watchers', () => {
  const store = new Map<string, any>();
  const watchers = new Map<number, { run: () => void }>();
  const proxyByKey = new Map<string, any>();

  // Type-level watchers: typename -> (wid -> run)
  const typeWatchers = new Map<string, Map<number, () => void>>();

  let nextWid = 1;
  let nextTypeWid = 10000;

  function runAllEntityWatchers() {
    for (const { run } of watchers.values()) run();
  }

  function runTypeWatchersForTypes(types: Set<string>) {
    for (const t of types) {
      const map = typeWatchers.get(t);
      if (!map) continue;
      for (const run of map.values()) run();
    }
  }

  /** Simulate a “graph flush”: overlay latest snaps into proxies, then run both entity + type watchers. */
  function bumpAll() {
    // overlay newest snapshots into proxies
    for (const [key, proxy] of proxyByKey.entries()) {
      const snap = store.get(key);
      if (!snap) continue;
      for (const k of Object.keys(proxy)) {
        if (k === '__typename' || k === 'id') continue;
        if (!(k in snap)) delete proxy[k];
      }
      for (const k of Object.keys(snap)) (proxy as any)[k] = snap[k];
    }

    // 1) entity watchers (for content changes on tracked keys)
    runAllEntityWatchers();

    // 2) type watchers (for membership changes on wildcards)
    const typesPresent = new Set<string>();
    for (const key of store.keys()) {
      const idx = key.indexOf(':');
      const t = idx === -1 ? key : key.slice(0, idx);
      typesPresent.add(t);
    }
    runTypeWatchersForTypes(typesPresent);
  }

  beforeEach(() => {
    store.clear();
    watchers.clear();
    proxyByKey.clear();
    typeWatchers.clear();
    nextWid = 1;
    nextTypeWid = 10000;

    const api = {
      readFragments: vi.fn((pattern: string | string[], { materialized = true } = {}) => {
        const pats = Array.isArray(pattern) ? pattern : [pattern];
        const keys: string[] = [];
        for (const p of pats) {
          if (p.endsWith(':*')) {
            const tn = p.slice(0, -2);
            for (const k of Array.from(store.keys())) if (k.startsWith(`${tn}:`)) keys.push(k);
          } else {
            if (store.has(p)) keys.push(p);
          }
        }
        keys.sort();
        return keys
          .map(k => {
            const snap = store.get(k);
            if (!snap) return undefined;
            if (materialized) {
              let proxy = proxyByKey.get(k);
              if (!proxy) {
                const [t, id] = k.split(':');
                proxy = Vue.reactive({ __typename: t, id, ...snap });
                proxyByKey.set(k, proxy);
              } else {
                for (const kk of Object.keys(proxy)) {
                  if (kk === '__typename' || kk === 'id') continue;
                  if (!(kk in snap)) delete proxy[kk];
                }
                for (const kk of Object.keys(snap)) (proxy as any)[kk] = snap[kk];
              }
              return proxy;
            }
            return { ...snap };
          })
          .filter(Boolean) as any[];
      }),

      // Key-level watcher API
      registerEntityWatcher: vi.fn((run: () => void) => {
        const wid = nextWid++;
        watchers.set(wid, { run });
        return wid;
      }),
      unregisterEntityWatcher: vi.fn((wid: number) => watchers.delete(wid)),
      trackEntity: vi.fn((_wid: number, _key: string) => { /* no reverse index in this mock */ }),

      // Type-level watcher API (NEW)
      registerTypeWatcher: vi.fn((typename: string, run: () => void) => {
        let map = typeWatchers.get(typename);
        if (!map) typeWatchers.set(typename, (map = new Map()));
        const id = nextTypeWid++;
        map.set(id, run);
        return id;
      }),
      unregisterTypeWatcher: vi.fn((typename: string, wid: number) => {
        typeWatchers.get(typename)?.delete(wid);
      }),
    };

    (Vue as any).__setInjectedApi(api);
  });

  it('materialized=true: recomputes list when entities/membership change', async () => {
    store.set('Post:1', { title: 'A' });
    store.set('Post:2', { title: 'B' });

    const listRef = useFragments<any>('Post:*', { materialized: true });
    expect(listRef.value.length).toBe(2);

    // Add a new member → type watchers should recompute
    store.set('Post:3', { title: 'C' });
    bumpAll();
    await Vue.nextTick();
    expect(listRef.value.length).toBe(3);

    // Update an existing member → entity watcher should recompute, proxies update
    store.set('Post:2', { title: 'B!' });
    bumpAll();
    await Vue.nextTick();
    expect(listRef.value.find((p: any) => p.id === '2')!.title).toBe('B!');
  });

  it('materialized=false: returns snapshot list; recomputes when membership or member changes', async () => {
    store.set('Post:1', { title: 'A' });
    store.set('Post:2', { title: 'B' });

    const listRef = useFragments<any>('Post:*', { materialized: false });
    const initial = listRef.value;
    expect(initial.length).toBe(2);

    // Change a member → recompute snapshots
    store.set('Post:1', { title: 'A!' });
    bumpAll();
    await Vue.nextTick();
    const updated = listRef.value;
    expect(updated).not.toBe(initial);
    expect(updated.find((p: any) => p.title === 'A!')).toBeTruthy();

    // Membership add → type watcher fires → recompute snapshots
    store.set('Post:3', { title: 'C' });
    bumpAll();
    await Vue.nextTick();
    expect(listRef.value.length).toBe(3);
  });
});
