export { createCachebay, provideCachebay } from './plugin';
export type { CachebayPlugin } from './plugin';

export { useCachebay } from './useCachebay';

export { useQuery } from './useQuery';
export type { UseQueryOptions, UseQueryReturn, BaseUseQueryReturn } from './useQuery';

export { useMutation } from './useMutation';
export type { UseMutationReturn } from './useMutation';

export { useSubscription } from './useSubscription';
export type { UseSubscriptionOptions, UseSubscriptionReturn } from './useSubscription';

export { useFragment } from './useFragment';
export type { UseFragmentOptions } from './useFragment';

export { CACHEBAY_KEY } from './constants';

export type {
  CachebayOptions,
  KeysConfig,
  InterfacesConfig,
  KeyFunction,
  PageInfo,
  Edge,
  Connection,
} from '../../core/types';

export type { CachebayInstance } from '../../core/client';

export type { CachePolicy } from '../../core/operations';
export { CACHE_AND_NETWORK, NETWORK_ONLY, CACHE_FIRST, CACHE_ONLY } from '../../core/operations';

export { CacheMissError, StaleResponseError, CombinedError } from '../../core/errors';
