import { describe, it, expect, vi } from 'vitest';
import { CACHEBAY_KEY, provideCachebay, buildCachebayPlugin } from '@/src/core/plugin';

describe('plugin — provideCachebay', () => {
  it('provides a minimal public API under CACHEBAY_KEY', () => {
    const provided: any = {};
    const app: any = { provide: (k: any, v: any) => { provided.key = k; provided.value = v; } };

    const instance: any = {
      readFragment: () => ({},
      writeFragment: (_: any) => ({ commit: () => { } },
      identify: (_: any) => 'X:1',
      modifyOptimistic: () => { },
      // optional passthroughs
      hasFragment: () => true,
      listEntityKeys: () => [],
      listEntities: () => [],
      inspect: () => ({},
      __entitiesTick: () => { },
    };

    provideCachebay(app, instance);

    expect(provided.key).toBe(CACHEBAY_KEY);
    expect(typeof provided.value.readFragment).toBe('function');
    expect(typeof provided.value.writeFragment).toBe('function');
    expect(typeof provided.value.identify).toBe('function');
    expect(typeof provided.value.modifyOptimistic).toBe('function');
    expect(typeof provided.value.hasFragment).toBe('function');
    expect(typeof provided.value.listEntityKeys).toBe('function');
    expect(typeof provided.value.listEntities).toBe('function');
    expect(typeof provided.value.inspect).toBe('function');
    expect(typeof provided.value.__entitiesTick).toBe('function');
  });
});

describe('plugin — buildCachebayPlugin', () => {
  it('returns a villus-compatible plugin function', () => {
    const mockGraph = {
      operationStore: new Map(),
      putOperation: vi.fn(),
    };
    const mockViews = {
      collectEntities: vi.fn(),
      registerViewsFromResult: vi.fn(),
    };
    const mockSsr = {
      isHydrating: vi.fn(() => false),
      hydrateOperationTicket: new Set(),
    };
    const plugin = buildCachebayPlugin(
      {
        addTypename: true,
      },
      {
        graph: mockGraph,
        views: mockViews,
        ssr: mockSsr,
        applyResolversOnGraph: vi.fn(),
      }
    );
    expect(typeof plugin).toBe('function');
  });
});
