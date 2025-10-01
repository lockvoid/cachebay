export type InterfacesConfig = Record<string, string[]>;

export type KeysConfig = Record<string, (obj: any, parent?: any) => string | null>;

export type CachebayOptions = {
  keys?: KeysConfig;
  interfaces?: InterfacesConfig;
  hydrationTimeout?: number;
  suspensionTimeout?: number;
};

export type UseFragmentOptions = {
  id: string | import('vue').Ref<string>;
  fragment: any; // string | DocumentNode | CachePlanV1
  fragmentName?: string;
  variables?: Record<string, any> | import('vue').Ref<Record<string, any> | undefined>;
};

export type ReadFragmentArgs = {
  id: string;
  fragment: any; // DocumentNode | CachePlanV1
  fragmentName?: string;
  variables?: Record<string, any>;
};

export type WriteFragmentArgs = {
  id: string;
  fragment: any; // DocumentNode | CachePlanV1
  fragmentName?: string;
  data: any;
  variables?: Record<string, any>;
};
