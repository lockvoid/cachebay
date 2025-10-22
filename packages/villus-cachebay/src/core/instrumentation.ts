/**
 * Development mode flag - computed once at module load.
 * Tree-shaken in production builds.
 */
export const __DEV__ = process.env.NODE_ENV === 'development';
