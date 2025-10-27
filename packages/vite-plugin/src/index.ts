import type { Plugin } from 'vite';
import { parse } from 'graphql';
import { compilePlan } from 'cachebay';
import { serializePlan } from './serialize';

export interface CachebayPluginOptions {
  /**
   * Include patterns for files to transform.
   * @default ['**\/*.{js,jsx,ts,tsx,vue}']
   */
  include?: string | string[];

  /**
   * Exclude patterns for files to skip.
   * @default ['node_modules/**', 'dist/**']
   */
  exclude?: string | string[];

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean;
}

/**
 * Vite plugin for Cachebay GraphQL query precompilation.
 * 
 * Transforms `gql` tagged templates into precompiled CachePlans at build time,
 * eliminating runtime compilation overhead.
 * 
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import cachebay from '@cachebay/vite';
 * 
 * export default defineConfig({
 *   plugins: [cachebay()],
 * });
 * ```
 */
export default function cachebayPlugin(options: CachebayPluginOptions = {}): Plugin {
  const {
    include = ['**/*.{js,jsx,ts,tsx,vue}'],
    exclude = ['node_modules/**', 'dist/**'],
    debug = false,
  } = options;

  return {
    name: 'vite-plugin-cachebay',

    transform(code: string, id: string) {
      // Skip if no gql tagged template
      if (!code.includes('gql`') && !code.includes('gql(')) {
        return null;
      }

      // Skip excluded files
      if (typeof exclude === 'string' && id.includes(exclude)) {
        return null;
      }
      if (Array.isArray(exclude) && exclude.some(pattern => id.includes(pattern))) {
        return null;
      }

      if (debug) {
        console.log('[cachebay] Processing:', id);
      }

      try {
        // Transform gql`` tagged templates
        const transformed = transformGqlTemplates(code, debug);
        
        if (transformed === code) {
          return null; // No changes
        }

        return {
          code: transformed,
          map: null, // TODO: Generate source map
        };
      } catch (error) {
        this.error(`Failed to transform ${id}: ${error}`);
      }
    },
  };
}

/**
 * Find and transform all gql`` tagged templates in the code.
 */
function transformGqlTemplates(code: string, debug: boolean): string {
  // Regex to match gql`...` or gql(`...`)
  const gqlRegex = /gql`([^`]+)`|gql\(`([^`]+)`\)/g;
  
  let transformed = code;
  let match: RegExpExecArray | null;

  while ((match = gqlRegex.exec(code)) !== null) {
    const queryString = match[1] || match[2];
    const fullMatch = match[0];

    try {
      // Parse GraphQL query
      const document = parse(queryString);

      // Compile to CachePlan
      const plan = compilePlan(document);

      // Serialize plan to JavaScript
      const serialized = serializePlan(plan);

      if (debug) {
        console.log('[cachebay] Compiled query:', queryString.slice(0, 50) + '...');
      }

      // Replace gql`` with serialized plan
      transformed = transformed.replace(fullMatch, serialized);
    } catch (error) {
      console.warn('[cachebay] Failed to compile query:', error);
      // Keep original code if compilation fails
    }
  }

  return transformed;
}
