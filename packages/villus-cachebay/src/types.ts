import type { CachebayInternals } from "./core/types";

export type WritePolicy = "replace" | "merge";

export type RelayOptsPartial = {
  edges?: string;
  node?: string;
  pageInfo?: string;
  after?: string;
  before?: string;
  first?: string;
  last?: string;
  write?: WritePolicy;
};

type PublishHint = {
  allowReplayOnStale?: boolean;
  stale?: boolean;
  relayView?: "windowed" | "cumulative";
  relayMode?: "append" | "prepend" | "replace" | "auto";
};

export type ResolverContext = {
  parentTypename: string;
  field: string;
  parent: any;
  value: any;
  variables: Record<string, any>;
  set: (next: any) => void;
  hint: PublishHint;
};

export type FieldResolver = (ctx: ResolverContext) => void;

export type ResolverSpec = {
  __cb_resolver__: true;
  bind: (inst: CachebayInternals) => FieldResolver;
};

export function defineResolver<TOpts>(
  binder: (inst: CachebayInternals, opts: TOpts) => FieldResolver,
) {
  return (opts: TOpts): ResolverSpec => {
    return { __cb_resolver__: true, bind: (inst) => binder(inst, opts) };
  };
}

// Flat types keep IDEs/parsers happy
export type ResolversDict = Record<
  string,
  Record<string, ResolverSpec | FieldResolver>
>;

export type InterfacesConfig =
  | Record<string, string[]>
  | (() => Record<string, string[]>);

export type KeysConfig =
  | (() => Record<string, (obj: any) => string | null>)
  | Record<string, (obj: any) => string | null>;

export type ResolversFactory = (r: {
  relay: (opts?: RelayOptsPartial) => ResolverSpec;
}) => ResolversDict;

export type CachebayOptions = {
  typenameKey?: string;
  addTypename?: boolean;
  keys?: KeysConfig;
  idFromObject?: (obj: any) => string | null;
  writePolicy?: WritePolicy;
  resolvers?: ResolversFactory | ResolversDict;
  interfaces?: InterfacesConfig;

  /** Shallow entity proxies to reduce deep tracking (default: false). */
  entityShallow?: boolean;

  /** Track non-Relay results as reactive views (default: true). */
  trackNonRelayResults?: boolean;

  /** LRU cap for operation cache (default 200). */
  lruOperationCacheSize?: number;
};
