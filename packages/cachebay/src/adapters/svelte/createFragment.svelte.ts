import { onDestroy } from "svelte";
import { getCachebay } from "./context";
import type { DocumentNode } from "graphql";

/**
 * Reactive getter type for Svelte 5 runes
 */
type MaybeGetter<T> = T | (() => T);

/**
 * Resolve a MaybeGetter to its current value
 */
const resolve = <T>(value: MaybeGetter<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;

/**
 * createFragment options
 */
export interface CreateFragmentOptions {
  /** Entity ID (typename:id) - can be a reactive getter */
  id: MaybeGetter<string>;
  /** GraphQL fragment document */
  fragment: DocumentNode | string;
  /** Fragment name if document contains multiple fragments */
  fragmentName?: string;
  /** GraphQL variables - can be a reactive getter */
  variables?: MaybeGetter<Record<string, unknown>>;
}

/**
 * createFragment return value.
 *
 * **IMPORTANT: Do not destructure this object.**
 * Destructuring (`const { data } = createFragment(...)`) breaks Svelte reactivity.
 * Use `fragment.data` in templates instead.
 */
export interface CreateFragmentReturn<TData = unknown> {
  /** Fragment data - undefined when entity is not in cache */
  readonly data: TData | undefined;
}

/**
 * Create a reactive fragment view from cache.
 * Returns a reactive object that updates when the fragment data changes.
 *
 * **IMPORTANT: Do not destructure the return value** — it breaks Svelte reactivity.
 * Use `const fragment = createFragment(...)` and access `fragment.data` in templates.
 *
 * @param options - Fragment configuration
 * @returns Reactive object with fragment data
 */
export function createFragment<TData = unknown>(options: CreateFragmentOptions): CreateFragmentReturn<TData> {
  const cache = getCachebay();

  if (typeof cache.watchFragment !== "function") {
    throw new Error("[cachebay] createFragment: cache.watchFragment() is required");
  }

  let data = $state<TData | undefined>(undefined);
  let handle: ReturnType<typeof cache.watchFragment> | null = null;

  $effect(() => {
    const id = resolve(options.id);
    const variables = resolve(options.variables) || {};

    if (!id) {
      // Clean up watcher if id becomes empty
      if (handle) {
        handle.unsubscribe();
        handle = null;
      }
      data = undefined;
      return;
    }

    // Reuse watcher with update() instead of remounting
    if (handle) {
      handle.update({ id, variables });
    } else {
      // Create new watcher on first run
      handle = cache.watchFragment({
        id,
        fragment: options.fragment,
        fragmentName: options.fragmentName,
        variables,
        onData: (newData: TData) => {
          data = newData;
        },
      });
    }
  });

  // Clean up on component unmount
  onDestroy(() => {
    if (handle) {
      handle.unsubscribe();
      handle = null;
    }
  });

  return {
    get data() { return data; },
  };
}
