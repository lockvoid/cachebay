import { vi } from 'vitest';

/**
 * Creates a minimal mock graph object for testing
 */
export function createMockGraph(overrides?: Partial<any>) {
  const entityStore = overrides?.entityStore || new Map();
  return {
    entityStore,
    connectionStore: new Map(),
    operationStore: new Map(),
    identify: vi.fn((obj: any) => obj?.__typename && obj?.id ? `${obj.__typename}:${obj.id}` : null),
    resolveEntityKey: vi.fn((key: string) => key),
    materializeEntity: vi.fn((key: string) => entityStore.get(key)),
    bumpEntitiesTick: vi.fn(),
    isInterfaceType: vi.fn(() => false),
    getInterfaceTypes: vi.fn(() => []),
    getEntityParentKey: vi.fn((typename: string, id?: any) => 
      typename === 'Query' ? 'Query' : id ? `${typename}:${id}` : null
    ),
    putEntity: vi.fn((obj: any) => obj?.__typename && obj?.id ? `${obj.__typename}:${obj.id}` : null),
    ensureReactiveConnection: vi.fn(),
    getReactiveEntity: vi.fn((obj: any) => obj),
    putOperation: vi.fn(),
    getEntityKeys: vi.fn(() => []),
    ...overrides,
  };
}

/**
 * Creates a minimal mock views object for testing
 */
export function createMockViews(overrides?: Partial<any>) {
  return {
    registerEntityView: vi.fn(),
    synchronizeEntityViews: vi.fn(),
    markEntityDirty: vi.fn(),
    proxyForEntityKey: vi.fn(),
    touchConnectionsForEntityKey: vi.fn(),
    linkEntityToConnection: vi.fn(),
    unlinkEntityFromConnection: vi.fn(),
    addStrongView: vi.fn(),
    markConnectionDirty: vi.fn(),
    synchronizeConnectionViews: vi.fn(),
    materializeResult: vi.fn(),
    gcConnections: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates mock dependencies for resolvers
 */
export function createMockResolverDeps(overrides?: { graph?: any; views?: any; utils?: any }) {
  return {
    graph: createMockGraph(overrides?.graph),
    views: createMockViews(overrides?.views),
    utils: {
      TYPENAME_KEY: '__typename',
      setRelayOptionsByType: vi.fn(),
      buildConnectionKey: vi.fn(),
      readPathValue: vi.fn((obj: any, path: string) => {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current == null) return undefined;
          current = current[part];
        }
        return current;
      }),
      applyFieldResolvers: vi.fn(),
      ...overrides?.utils,
    },
  };
}

/**
 * Creates a sample entity for testing
 */
export function createEntity(typename: string, id: string | number, data?: Record<string, any>) {
  return {
    __typename: typename,
    id,
    ...data,
  };
}
