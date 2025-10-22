/**
 * Development mode flag - computed once at module load.
 * Tree-shaken in production builds.
 */
export const __DEV__ =
  (typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') ||
  (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.MODE !== 'production');
