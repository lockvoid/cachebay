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
  write?: "replace" | "merge"
  mode?: "append" | "prepend" | "replace" | "auto";
};
