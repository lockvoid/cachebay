// Vue adapter for Cachebay
// Provides Vue-specific hooks and plugin

// Vue Plugin
export { createCachebayPlugin, provideCachebay } from './plugin';
export type { CachebayPlugin, CachebayPluginOptions } from './plugin';

// Hooks
export { useClient } from './useClient';
export { useQuery } from './useQuery';
export type { UseQueryOptions, UseQueryReturn, BaseUseQueryReturn } from './useQuery';
export { useMutation } from './useMutation';
export type { UseMutationReturn } from './useMutation';
export { useSubscription } from './useSubscription';
export type { UseSubscriptionOptions, UseSubscriptionReturn } from './useSubscription';
