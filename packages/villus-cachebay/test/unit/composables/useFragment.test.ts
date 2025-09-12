import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 'vue' module to control inject; keep real reactivity
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
import { useFragment } from '@/src/composables/useFragment';

describe('useFragment with graph watchers', () => {
  const store = new Map<string, any>();
  const watchers = new Map<number, { run: () => void }>();
  const proxyByKey = new Map<string, any>();
  let nextWid = 1;

  function bump(key: string, updated: any) {
    // update raw snapshot
    store.set(key, updated);
    // overlay into materialized proxy if exists
    const proxy = proxyByKey.get(key);
    if (proxy) {
      // remove missing fields
      for (const k of Object.keys(proxy)) {
        if (k === '__typename' || k === 'id') continue;
        if (!(k in updated)) delete proxy[k];
      }
      for (const k of Object.keys(updated)) (proxy as any)[k] = updated[k];
    }
    // notify watchers (non-materialized snapshots)
    for (const { run } of watchers.values()) run();
  }

  beforeEach(() => {
    store.clear();
    watchers.clear();
    proxyByKey.clear();
    nextWid = 1;

    const api = {
      readFragment: vi.fn((refOrKey: any, { materialized = true } = {}) => {
        const key =
          typeof refOrKey === 'string'
            ? refOrKey
            : (refOrKey.__typename && refOrKey.id != null ? `${refOrKey.__typename}:${String(refOrKey.id)}` : null);
        if (!key) return null;
        const snap = store.get(key);
        if (!snap) return null;

        if (materialized) {
          let proxy = proxyByKey.get(key);
          if (!proxy) {
            const [t, id] = key.split(':');
            proxy = Vue.reactive({ __typename: t, id, ...snap });
            proxyByKey.set(key, proxy);
          } else {
            // overlay newest snapshot into existing proxy
            for (const k of Object.keys(proxy)) {
              if (k === '__typename' || k === 'id') continue;
              if (!(k in snap)) delete proxy[k];
            }
            for (const k of Object.keys(snap)) (proxy as any)[k] = snap[k];
          }
          return proxy;
        }
        return { ...snap };
      }),
      registerEntityWatcher: vi.fn((run: () => void) => {
        const wid = nextWid++;
        watchers.set(wid, { run });
        return wid;
      }),
      unregisterEntityWatcher: vi.fn((wid: number) => {
        watchers.delete(wid);
      }),
      trackEntity: vi.fn((_wid: number, _key: string) => { }),
    };

    (Vue as any).__setInjectedApi(api);
  });

  it('dynamic + non-materialized: updates snapshot when the entity changes (via watcher)', async () => {
    const keyRef = Vue.ref<any>({ __typename: 'Post', id: '1' });
    store.set('Post:1', { title: 'A' });

    const out = useFragment<any>(keyRef, { materialized: false, mode: 'dynamic' }) as Vue.Ref<any>;
    expect(out.value.title).toBe('A');

    bump('Post:1', { title: 'A!' });
    await Vue.nextTick();
    expect(out.value.title).toBe('A!');

    store.set('Post:2', { title: 'B' });
    keyRef.value = { __typename: 'Post', id: '2' };
    await Vue.nextTick();
    expect(out.value.title).toBe('B');
  });

  it('dynamic + materialized: swaps proxy on key change; proxy updates itself on entity change', async () => {
    const keyRef = Vue.ref<any>('Post:1');
    store.set('Post:1', { title: 'A' });
    store.set('Post:2', { title: 'B' });

    const out = useFragment<any>(keyRef, { materialized: true, mode: 'dynamic' }) as Vue.Ref<any>;
    expect(out.value.title).toBe('A');

    keyRef.value = 'Post:2';
    await Vue.nextTick();
    expect(out.value.title).toBe('B');

    bump('Post:2', { title: 'B!' });
    await Vue.nextTick();
    expect(out.value.title).toBe('B!');
  });
});
