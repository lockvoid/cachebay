export type WritePolicy = "replace" | "merge";

export type ReactiveMode = "shallow" | "deep";

export type RelayOptsPartial = {
  edges?: string;
  node?: string;
  pageInfo?: string;
  after?: string;
  before?: string;
  first?: string;
  last?: string;
  writePolicy?: WritePolicy;
  paginationMode?: "append" | "prepend" | "replace" | "auto";
};

type PublishHint = {
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
  bind: (deps: any) => FieldResolver;
};

export function defineResolver<TOpts>(
  binder: (opts: TOpts) => (deps: any) => FieldResolver,
) {
  return (opts: TOpts): ResolverSpec => {
    return { __cb_resolver__: true, bind: binder(opts) };
  };
}

// Flat types keep IDEs/parsers happy
export type ResolversDict = Record<
  string,
  Record<string, ResolverSpec | FieldResolver>
>;

export type InterfacesConfig = Record<string, string[]>;

export type KeysConfig = Record<string, (obj: any, parent?: any) => string | null>;

export type CachebayOptions = {
  addTypename?: boolean;
  keys?: KeysConfig;
  writePolicy?: WritePolicy;
  reactiveMode?: ReactiveMode;
  resolvers?: ResolversDict;
  interfaces?: InterfacesConfig;
  /** Track non-Relay results as reactive views (default: true). */
  trackNonRelayResults?: boolean;
};
