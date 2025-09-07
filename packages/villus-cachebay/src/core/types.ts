import type { WritePolicy } from "../types";
import { reactive, isReactive, shallowReactive } from "vue";

export type EntityKey = string;

export type ConnectionEntry = { key: EntityKey; cursor: string | null; edge?: Record<string, any> };
export type ConnectionEntrySnapshot = { key: string; cursor: string | null; edge?: Record<string, any> };

export type ConnectionView = {
  edges: any[];
  pageInfo: any;
  root: any;
  edgesKey?: string;
  pageInfoKey?: string;
  pinned?: boolean;
  limit?: number;
  _lastLen?: number;
};

export type ConnectionState = {
  list: ConnectionEntry[];
  pageInfo: any;
  meta: any;
  views: Set<ConnectionView>;
  keySet: Set<EntityKey>;
  initialized: boolean;
  __key?: string;
};

export type RelayOptions = {
  paths: { edges: string; node: string; pageInfo: string };
  segs: { edges: string[]; node: string[]; pageInfo: string[] };
  names: { edges: string; pageInfo: string; nodeField: string };
  cursors: { after: string; before: string; first: string; last: string };
  hasNodePath: boolean;
  write?: WritePolicy;
  mode?: "append" | "prepend" | "replace" | "auto";
};

export type CachebayInternals = {
  TYPENAME_KEY: string;
  DEFAULT_WRITE_POLICY: WritePolicy;

  entityStore: Map<string, any>;
  connectionStore: Map<string, ConnectionState>;

  relayResolverIndex: Map<string, RelayOptions>;
  relayResolverIndexByType: Map<string, Map<string, RelayOptions>>;
  getRelayOptionsByType: (parentTypename: string | null, field: string) => RelayOptions | undefined;
  setRelayOptionsByType: (parentTypename: string, field: string, opts: RelayOptions) => void;

  operationCache: Map<string, { data: any; variables: Record<string, any> }>;

  putEntity: (obj: any, override?: WritePolicy) => string | null;
  materializeEntity: (key: string) => any;
  ensureConnectionState: (key: string) => ConnectionState;
  synchronizeConnectionViews: (state: ConnectionState) => void;
  parentEntityKeyFor: (typename: string, id?: any) => string | null;
  buildConnectionKey: (parent: string, field: string, opts: RelayOptions, vars: Record<string, any>) => string;
  readPathValue: (obj: any, path: string | string[]) => any;
  markConnectionDirty: (state: ConnectionState) => void;
  linkEntityToConnection: (key: string, state: ConnectionState) => void;
  unlinkEntityFromConnection: (key: string, state: ConnectionState) => void;
  addStrongView: (state: ConnectionState, v: ConnectionView) => void;
  isReactive: typeof isReactive;
  reactive: typeof reactive;
  shallowReactive?: typeof shallowReactive;

  applyFieldResolvers?: (typename: string, obj: any, vars: Record<string, any>, hint: any) => void;
};
