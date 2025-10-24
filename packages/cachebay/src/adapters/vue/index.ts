// Vue adapter for Cachebay
// Provides Vue-specific hooks and plugin

// Vue Plugin
export { createCachebay, provideCachebay } from './plugin';
export type { CachebayPlugin } from './plugin';

// Hooks
export { useCachebay } from './useCachebay';
export { useQuery } from './useQuery';
export type { UseQueryOptions, UseQueryReturn, BaseUseQueryReturn } from './useQuery';
export { useMutation } from './useMutation';
export type { UseMutationReturn } from './useMutation';
export { useSubscription } from './useSubscription';
export type { UseSubscriptionOptions, UseSubscriptionReturn } from './useSubscription';
export { useFragment } from './useFragment';
export type { UseFragmentOptions } from './useFragment';
