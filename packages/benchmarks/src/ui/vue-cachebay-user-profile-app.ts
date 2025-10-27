import { gql } from "graphql-tag";
import { createApp, defineComponent, nextTick, ref, watch } from "vue";
import { createCachebay, useQuery } from "../../../cachebay/src/adapters/vue";
import { createUserProfileYoga } from "../server/user-profile-server";
import { makeUserProfileDataset } from "../utils/seed-user-profile";
import { createDeferred } from "../utils/concurrency";
import serJs from 'serialize-javascript';
import { plan } from './plan';

const USER_QUERY = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      username
      phone
      website
      company
      bio
      avatar
      createdAt
      profile {
        id
        bio
        avatar
        location
        website
        twitter
        github
        linkedin
        followers
        following
      }
    }
  }
`;

export type VueCachebayUserProfileController = {
  mount(target?: Element): void;
  unmount(): void;
  ready(): Promise<void>;
};

const __indexByResponseKey = (fields) => {
  if (!fields || fields.length === 0) return undefined;
  const m = new Map();
  for (let i = 0; i < fields.length; i++) m.set(fields[i].responseKey, fields[i]);
  return m;
};

const __fastStringify = (value) => {
  const t = typeof value;
  if (t === "string") return '"' + value + '"';
  if (t === "number") return String(value);
  if (t === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  return JSON.stringify(value);
};

const __stableStringify = (object) => {
  const walk = (obj) => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(walk);
    const out = {};
    const keys = Object.keys(obj).sort();
    for (let i = 0; i < keys.length; i++) out[keys[i]] = walk(obj[keys[i]]);
    return out;
  };
  return JSON.stringify(walk(object));
};

// arg spec -> buildArgs(vars)
const __resolveSpec = (node, vars) => {
  switch (node.kind) {
    case "var":   return vars[node.name];
    case "const": return node.value;
    case "array": return node.items.map(n => __resolveSpec(n, vars));
    case "object": {
      const out = {};
      for (let i = 0; i < node.entries.length; i++) {
        const [k, v] = node.entries[i];
        const val = __resolveSpec(v, vars);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
  }
};

const __makeBuildArgs = (spec) => (vars) => {
  if (!spec.length) return {};
  const out = {};
  for (let i = 0; i < spec.length; i++) {
    const [name, node] = spec[i];
    const val = __resolveSpec(node, vars);
    if (val !== undefined) out[name] = val;
  }
  return out;
};

const __makeStringifyArgs = (buildArgs, expectedArgNames) => {
  if (!expectedArgNames.length) return () => "";
  const stringifiedArgNames = expectedArgNames.map(n => '"' + n + '":');
  return (vars) => {
    const args = buildArgs(vars);
    const parts = [];
    for (let i = 0; i < expectedArgNames.length; i++) {
      const name = expectedArgNames[i];
      const value = args[name];
      if (value !== undefined) parts.push(stringifiedArgNames[i] + __fastStringify(value));
    }
    return "{" + parts.join(",") + "}";
  };
};

// Field & connection key builders
const __ROOT = "@";
const __CONNECTION_FIELDS = new Set(["first","last","after","before"]);

const __buildFieldKey = (field, variables) => {
  const args = field.stringifyArgs(variables);
  return args === "" || args === "{}" ? field.fieldName : (field.fieldName + "(" + args + ")");
};

const __buildConnectionKey = (field, parentId, variables) => {
  const base = parentId && parentId[0] === __ROOT ? parentId : (__ROOT + "." + (parentId || ""));
  return base + "." + field.fieldName + "(" + field.stringifyArgs(variables) + ")";
};

const __buildConnectionCanonicalKey = (field, parentId, variables) => {
  const allArgs = field.buildArgs(variables) || {};
  const identity = {};
  if (field.connectionFilters) {
    for (let i = 0; i < field.connectionFilters.length; i++) {
      const name = field.connectionFilters[i];
      if (__CONNECTION_FIELDS.has(name)) continue;
      if (name in allArgs) identity[name] = allArgs[name];
    }
  } else {
    // fallback: include non-pagination args
    for (const k in allArgs) if (!__CONNECTION_FIELDS.has(k)) identity[k] = allArgs[k];
  }
  const parentPart = (parentId === __ROOT) ? "@connection." : ("@connection." + parentId + ".");
  const keyPart = field.connectionKey || field.fieldName;
  return parentPart + keyPart + "(" + __stableStringify(identity) + ")";
};

// masked vars key
const __makeMaskedVarsKeyFn = (strictMask, canonicalMask) => {
  const strict = strictMask.slice();         // keep the order given by the compiler
  const canonical = canonicalMask.slice();
  return (mode, vars) => {
    const mask = mode === "canonical" ? canonical : strict;
    if (!mask.length) return "{}";
    const parts = [];
    for (let i = 0; i < mask.length; i++) {
      const k = mask[i];
      if (vars[k] === undefined) continue;
      parts.push('"' + k + '":' + __stableStringify(vars[k]));
    }
    return "{" + parts.join(",") + "}";
  };
};

const f2_children = [];
const f2_map = __indexByResponseKey(f2_children);
const f2_build = __makeBuildArgs([]);
const f2_str = __makeStringifyArgs(f2_build, []);
const f2 = {responseKey:"id",fieldName:"id",selectionSet:f2_children.length?f2_children:null,selectionMap:f2_children.length?f2_map:undefined,buildArgs:f2_build,stringifyArgs:f2_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"id:id"};
const f3_children = [];
const f3_map = __indexByResponseKey(f3_children);
const f3_build = __makeBuildArgs([]);
const f3_str = __makeStringifyArgs(f3_build, []);
const f3 = {responseKey:"name",fieldName:"name",selectionSet:f3_children.length?f3_children:null,selectionMap:f3_children.length?f3_map:undefined,buildArgs:f3_build,stringifyArgs:f3_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"name:name"};
const f4_children = [];
const f4_map = __indexByResponseKey(f4_children);
const f4_build = __makeBuildArgs([]);
const f4_str = __makeStringifyArgs(f4_build, []);
const f4 = {responseKey:"email",fieldName:"email",selectionSet:f4_children.length?f4_children:null,selectionMap:f4_children.length?f4_map:undefined,buildArgs:f4_build,stringifyArgs:f4_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"email:email"};
const f5_children = [];
const f5_map = __indexByResponseKey(f5_children);
const f5_build = __makeBuildArgs([]);
const f5_str = __makeStringifyArgs(f5_build, []);
const f5 = {responseKey:"username",fieldName:"username",selectionSet:f5_children.length?f5_children:null,selectionMap:f5_children.length?f5_map:undefined,buildArgs:f5_build,stringifyArgs:f5_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"username:username"};
const f6_children = [];
const f6_map = __indexByResponseKey(f6_children);
const f6_build = __makeBuildArgs([]);
const f6_str = __makeStringifyArgs(f6_build, []);
const f6 = {responseKey:"phone",fieldName:"phone",selectionSet:f6_children.length?f6_children:null,selectionMap:f6_children.length?f6_map:undefined,buildArgs:f6_build,stringifyArgs:f6_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"phone:phone"};
const f7_children = [];
const f7_map = __indexByResponseKey(f7_children);
const f7_build = __makeBuildArgs([]);
const f7_str = __makeStringifyArgs(f7_build, []);
const f7 = {responseKey:"website",fieldName:"website",selectionSet:f7_children.length?f7_children:null,selectionMap:f7_children.length?f7_map:undefined,buildArgs:f7_build,stringifyArgs:f7_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"website:website"};
const f8_children = [];
const f8_map = __indexByResponseKey(f8_children);
const f8_build = __makeBuildArgs([]);
const f8_str = __makeStringifyArgs(f8_build, []);
const f8 = {responseKey:"company",fieldName:"company",selectionSet:f8_children.length?f8_children:null,selectionMap:f8_children.length?f8_map:undefined,buildArgs:f8_build,stringifyArgs:f8_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"company:company"};
const f9_children = [];
const f9_map = __indexByResponseKey(f9_children);
const f9_build = __makeBuildArgs([]);
const f9_str = __makeStringifyArgs(f9_build, []);
const f9 = {responseKey:"bio",fieldName:"bio",selectionSet:f9_children.length?f9_children:null,selectionMap:f9_children.length?f9_map:undefined,buildArgs:f9_build,stringifyArgs:f9_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"bio:bio"};
const f10_children = [];
const f10_map = __indexByResponseKey(f10_children);
const f10_build = __makeBuildArgs([]);
const f10_str = __makeStringifyArgs(f10_build, []);
const f10 = {responseKey:"avatar",fieldName:"avatar",selectionSet:f10_children.length?f10_children:null,selectionMap:f10_children.length?f10_map:undefined,buildArgs:f10_build,stringifyArgs:f10_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"avatar:avatar"};
const f11_children = [];
const f11_map = __indexByResponseKey(f11_children);
const f11_build = __makeBuildArgs([]);
const f11_str = __makeStringifyArgs(f11_build, []);
const f11 = {responseKey:"createdAt",fieldName:"createdAt",selectionSet:f11_children.length?f11_children:null,selectionMap:f11_children.length?f11_map:undefined,buildArgs:f11_build,stringifyArgs:f11_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"createdAt:createdAt"};
const f13_children = [];
const f13_map = __indexByResponseKey(f13_children);
const f13_build = __makeBuildArgs([]);
const f13_str = __makeStringifyArgs(f13_build, []);
const f13 = {responseKey:"id",fieldName:"id",selectionSet:f13_children.length?f13_children:null,selectionMap:f13_children.length?f13_map:undefined,buildArgs:f13_build,stringifyArgs:f13_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"id:id"};
const f14_children = [];
const f14_map = __indexByResponseKey(f14_children);
const f14_build = __makeBuildArgs([]);
const f14_str = __makeStringifyArgs(f14_build, []);
const f14 = {responseKey:"bio",fieldName:"bio",selectionSet:f14_children.length?f14_children:null,selectionMap:f14_children.length?f14_map:undefined,buildArgs:f14_build,stringifyArgs:f14_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"bio:bio"};
const f15_children = [];
const f15_map = __indexByResponseKey(f15_children);
const f15_build = __makeBuildArgs([]);
const f15_str = __makeStringifyArgs(f15_build, []);
const f15 = {responseKey:"avatar",fieldName:"avatar",selectionSet:f15_children.length?f15_children:null,selectionMap:f15_children.length?f15_map:undefined,buildArgs:f15_build,stringifyArgs:f15_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"avatar:avatar"};
const f16_children = [];
const f16_map = __indexByResponseKey(f16_children);
const f16_build = __makeBuildArgs([]);
const f16_str = __makeStringifyArgs(f16_build, []);
const f16 = {responseKey:"location",fieldName:"location",selectionSet:f16_children.length?f16_children:null,selectionMap:f16_children.length?f16_map:undefined,buildArgs:f16_build,stringifyArgs:f16_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"location:location"};
const f17_children = [];
const f17_map = __indexByResponseKey(f17_children);
const f17_build = __makeBuildArgs([]);
const f17_str = __makeStringifyArgs(f17_build, []);
const f17 = {responseKey:"website",fieldName:"website",selectionSet:f17_children.length?f17_children:null,selectionMap:f17_children.length?f17_map:undefined,buildArgs:f17_build,stringifyArgs:f17_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"website:website"};
const f18_children = [];
const f18_map = __indexByResponseKey(f18_children);
const f18_build = __makeBuildArgs([]);
const f18_str = __makeStringifyArgs(f18_build, []);
const f18 = {responseKey:"twitter",fieldName:"twitter",selectionSet:f18_children.length?f18_children:null,selectionMap:f18_children.length?f18_map:undefined,buildArgs:f18_build,stringifyArgs:f18_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"twitter:twitter"};
const f19_children = [];
const f19_map = __indexByResponseKey(f19_children);
const f19_build = __makeBuildArgs([]);
const f19_str = __makeStringifyArgs(f19_build, []);
const f19 = {responseKey:"github",fieldName:"github",selectionSet:f19_children.length?f19_children:null,selectionMap:f19_children.length?f19_map:undefined,buildArgs:f19_build,stringifyArgs:f19_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"github:github"};
const f20_children = [];
const f20_map = __indexByResponseKey(f20_children);
const f20_build = __makeBuildArgs([]);
const f20_str = __makeStringifyArgs(f20_build, []);
const f20 = {responseKey:"linkedin",fieldName:"linkedin",selectionSet:f20_children.length?f20_children:null,selectionMap:f20_children.length?f20_map:undefined,buildArgs:f20_build,stringifyArgs:f20_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"linkedin:linkedin"};
const f21_children = [];
const f21_map = __indexByResponseKey(f21_children);
const f21_build = __makeBuildArgs([]);
const f21_str = __makeStringifyArgs(f21_build, []);
const f21 = {responseKey:"followers",fieldName:"followers",selectionSet:f21_children.length?f21_children:null,selectionMap:f21_children.length?f21_map:undefined,buildArgs:f21_build,stringifyArgs:f21_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"followers:followers"};
const f22_children = [];
const f22_map = __indexByResponseKey(f22_children);
const f22_build = __makeBuildArgs([]);
const f22_str = __makeStringifyArgs(f22_build, []);
const f22 = {responseKey:"following",fieldName:"following",selectionSet:f22_children.length?f22_children:null,selectionMap:f22_children.length?f22_map:undefined,buildArgs:f22_build,stringifyArgs:f22_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"following:following"};
const f23_children = [];
const f23_map = __indexByResponseKey(f23_children);
const f23_build = __makeBuildArgs([]);
const f23_str = __makeStringifyArgs(f23_build, []);
const f23 = {responseKey:"__typename",fieldName:"__typename",selectionSet:f23_children.length?f23_children:null,selectionMap:f23_children.length?f23_map:undefined,buildArgs:f23_build,stringifyArgs:f23_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"__typename:__typename"};
const f12_children = [f13,f14,f15,f16,f17,f18,f19,f20,f21,f22,f23];
const f12_map = __indexByResponseKey(f12_children);
const f12_build = __makeBuildArgs([]);
const f12_str = __makeStringifyArgs(f12_build, []);
const f12 = {responseKey:"profile",fieldName:"profile",selectionSet:f12_children.length?f12_children:null,selectionMap:f12_children.length?f12_map:undefined,buildArgs:f12_build,stringifyArgs:f12_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"profile:profile:{__typename:__typename,avatar:avatar,bio:bio,followers:followers,following:following,github:github,id:id,linkedin:linkedin,location:location,twitter:twitter,website:website}"};
const f24_children = [];
const f24_map = __indexByResponseKey(f24_children);
const f24_build = __makeBuildArgs([]);
const f24_str = __makeStringifyArgs(f24_build, []);
const f24 = {responseKey:"__typename",fieldName:"__typename",selectionSet:f24_children.length?f24_children:null,selectionMap:f24_children.length?f24_map:undefined,buildArgs:f24_build,stringifyArgs:f24_str,expectedArgNames:[],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"__typename:__typename"};
const f1_children = [f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f24];
const f1_map = __indexByResponseKey(f1_children);
const f1_build = __makeBuildArgs([["id",{"kind":"var","name":"id"}]]);
const f1_str = __makeStringifyArgs(f1_build, ["id"]);
const f1 = {responseKey:"user",fieldName:"user",selectionSet:f1_children.length?f1_children:null,selectionMap:f1_children.length?f1_map:undefined,buildArgs:f1_build,stringifyArgs:f1_str,expectedArgNames:["id"],isConnection:false,connectionKey:undefined,connectionFilters:undefined,connectionMode:undefined,typeCondition:undefined,pageArgs:undefined,selId:"user:user:(id):{__typename:__typename,avatar:avatar,bio:bio,company:company,createdAt:createdAt,email:email,id:id,name:name,phone:phone,profile:profile:{__typename:__typename,avatar:avatar,bio:bio,followers:followers,following:following,github:github,id:id,linkedin:linkedin,location:location,twitter:twitter,website:website},username:username,website:website}"};
const __root = [f1];
const __rootMap = __indexByResponseKey(__root);
const __depFields = [{field:f1,isConnection:false,parentTypename:"Query"}];
const __internalMakeVarsKey = __makeMaskedVarsKeyFn(["id"], ["id"]);
const __makeVarsKey = (canonical, vars) => __internalMakeVarsKey(canonical ? "canonical" : "strict", vars);
const __makeSignature = (canonical, vars) => 1906052587 + "|" + (canonical ? "canonical" : "strict") + "|" + __internalMakeVarsKey(canonical ? "canonical" : "strict", vars);

const __getDependencies = (canonical, vars) => {
  const out = new Set();
  for (let i = 0; i < __depFields.length; i++) {
    const { field, isConnection, parentTypename } = __depFields[i];
    const parentId = parentTypename === "Query" ? "@" : parentTypename;
    if (isConnection) {
      out.add(canonical ? __buildConnectionCanonicalKey(field, parentId, vars)
                        : __buildConnectionKey(field, parentId, vars));
    } else {
      out.add(__buildFieldKey(field, vars));
    }
  }
  return out;
};

const __plan = {
  kind: "CachePlan",
  operation: "query",
  rootTypename: "Query",
  root: __root,
  rootSelectionMap: __rootMap,
  networkQuery: "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n    email\n    username\n    phone\n    website\n    company\n    bio\n    avatar\n    createdAt\n    profile {\n      id\n      bio\n      avatar\n      location\n      website\n      twitter\n      github\n      linkedin\n      followers\n      following\n      __typename\n    }\n    __typename\n  }\n}",
  id: 1906052587,
  varMask: { strict: ["id"], canonical: ["id"] },
  makeVarsKey: __makeVarsKey,
  makeSignature: __makeSignature,
  getDependencies: __getDependencies,
  windowArgs: new Set([]),
  selectionFingerprint: "query:Query:[user:user:(id):{__typename:__typename,avatar:avatar,bio:bio,company:company,createdAt:createdAt,email:email,id:id,name:name,phone:phone,profile:profile:{__typename:__typename,avatar:avatar,bio:bio,followers:followers,following:following,github:github,id:id,linkedin:linkedin,location:location,twitter:twitter,website:website},username:username,website:website}]",
};


export function emitCachePlanModule(plan: CachePlan): string {
  type ArgSpecNode =
    | { kind: "var"; name: string }
    | { kind: "const"; value: any }
    | { kind: "array"; items: ArgSpecNode[] }
    | { kind: "object"; entries: Array<[string, ArgSpecNode]> };

  type ArgSpec = Array<[string, ArgSpecNode]>;

  /** Build a stable “arg spec” for a field by executing its buildArgs once with a proxy. */
  const VAR_TAG = Symbol("var");
  const toSpecNode = (v: any): ArgSpecNode => {
    // variable placeholder we inject via Proxy: { [VAR_TAG]: 'name' }
    if (v && typeof v === "object" && VAR_TAG in v) {
      return { kind: "var", name: (v as any)[VAR_TAG] as string };
    }
    if (Array.isArray(v)) {
      return { kind: "array", items: v.map(toSpecNode) };
    }
    if (v && typeof v === "object") {
      const entries: Array<[string, ArgSpecNode]> = [];
      for (const k of Object.keys(v)) entries.push([k, toSpecNode(v[k])]);
      return { kind: "object", entries };
    }
    return { kind: "const", value: v };
  };

  const buildArgSpec = (field: PlanField): ArgSpec => {
    // Vars proxy returns a small placeholder object that records the accessed variable name.
    const varsProxy = new Proxy(
      {},
      {
        get: (_t, prop) => ({ [VAR_TAG]: String(prop) }),
        has: () => true,
      },
    ) as any;

    const args = (field.buildArgs?.(varsProxy) ?? {}) as Record<string, any>;
    const ordered = (field.expectedArgNames?.length ? field.expectedArgNames : Object.keys(args)) as string[];
    const spec: ArgSpec = [];
    for (const name of ordered) {
      if (name in args) {
        spec.push([name, toSpecNode(args[name])]);
      }
    }
    return spec;
  };

  /** Assign stable names to all PlanFields so we can reference them in emitted JS. */
  let nextId = 0;
  const fieldVar = new Map<PlanField, string>();
  const depItems: Array<{ varName: string; isConnection: boolean; parentTypename: string }> = [];

  // Depth-first walk to name fields deterministically and collect dependency items.
  const walk = (fields: PlanField[] | null | undefined, parentTypename: string) => {
    if (!fields) return;
    for (const f of fields) {
      if (!fieldVar.has(f)) fieldVar.set(f, `f${++nextId}`);
      // Track dependencies: connection fields or fields that actually have arguments
      const hasArgs = !!(f.expectedArgNames && f.expectedArgNames.length);
      if (f.isConnection || hasArgs) {
        depItems.push({
          varName: fieldVar.get(f)!,
          isConnection: !!f.isConnection,
          // We do not rely on schema; we namespace by the nearest known parent
          parentTypename,
        });
      }
      walk(f.selectionSet, f.typeCondition || parentTypename);
    }
  };

  walk(plan.root, plan.rootTypename);

  // Emit helpers (one per module)
  const helpers = `
const __indexByResponseKey = (fields) => {
  if (!fields || fields.length === 0) return undefined;
  const m = new Map();
  for (let i = 0; i < fields.length; i++) m.set(fields[i].responseKey, fields[i]);
  return m;
};

const __fastStringify = (value) => {
  const t = typeof value;
  if (t === "string") return '"' + value + '"';
  if (t === "number") return String(value);
  if (t === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  return JSON.stringify(value);
};

const __stableStringify = (object) => {
  const walk = (obj) => {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(walk);
    const out = {};
    const keys = Object.keys(obj).sort();
    for (let i = 0; i < keys.length; i++) out[keys[i]] = walk(obj[keys[i]]);
    return out;
  };
  return JSON.stringify(walk(object));
};

// arg spec -> buildArgs(vars)
const __resolveSpec = (node, vars) => {
  switch (node.kind) {
    case "var":   return vars[node.name];
    case "const": return node.value;
    case "array": return node.items.map(n => __resolveSpec(n, vars));
    case "object": {
      const out = {};
      for (let i = 0; i < node.entries.length; i++) {
        const [k, v] = node.entries[i];
        const val = __resolveSpec(v, vars);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
  }
};

const __makeBuildArgs = (spec) => (vars) => {
  if (!spec.length) return {};
  const out = {};
  for (let i = 0; i < spec.length; i++) {
    const [name, node] = spec[i];
    const val = __resolveSpec(node, vars);
    if (val !== undefined) out[name] = val;
  }
  return out;
};

const __makeStringifyArgs = (buildArgs, expectedArgNames) => {
  if (!expectedArgNames.length) return () => "";
  const stringifiedArgNames = expectedArgNames.map(n => '"' + n + '":');
  return (vars) => {
    const args = buildArgs(vars);
    const parts = [];
    for (let i = 0; i < expectedArgNames.length; i++) {
      const name = expectedArgNames[i];
      const value = args[name];
      if (value !== undefined) parts.push(stringifiedArgNames[i] + __fastStringify(value));
    }
    return "{" + parts.join(",") + "}";
  };
};

// Field & connection key builders
const __ROOT = "@";
const __CONNECTION_FIELDS = new Set(["first","last","after","before"]);

const __buildFieldKey = (field, variables) => {
  const args = field.stringifyArgs(variables);
  return args === "" || args === "{}" ? field.fieldName : (field.fieldName + "(" + args + ")");
};

const __buildConnectionKey = (field, parentId, variables) => {
  const base = parentId && parentId[0] === __ROOT ? parentId : (__ROOT + "." + (parentId || ""));
  return base + "." + field.fieldName + "(" + field.stringifyArgs(variables) + ")";
};

const __buildConnectionCanonicalKey = (field, parentId, variables) => {
  const allArgs = field.buildArgs(variables) || {};
  const identity = {};
  if (field.connectionFilters) {
    for (let i = 0; i < field.connectionFilters.length; i++) {
      const name = field.connectionFilters[i];
      if (__CONNECTION_FIELDS.has(name)) continue;
      if (name in allArgs) identity[name] = allArgs[name];
    }
  } else {
    // fallback: include non-pagination args
    for (const k in allArgs) if (!__CONNECTION_FIELDS.has(k)) identity[k] = allArgs[k];
  }
  const parentPart = (parentId === __ROOT) ? "@connection." : ("@connection." + parentId + ".");
  const keyPart = field.connectionKey || field.fieldName;
  return parentPart + keyPart + "(" + __stableStringify(identity) + ")";
};

// masked vars key
const __makeMaskedVarsKeyFn = (strictMask, canonicalMask) => {
  const strict = strictMask.slice();         // keep the order given by the compiler
  const canonical = canonicalMask.slice();
  return (mode, vars) => {
    const mask = mode === "canonical" ? canonical : strict;
    if (!mask.length) return "{}";
    const parts = [];
    for (let i = 0; i < mask.length; i++) {
      const k = mask[i];
      if (vars[k] === undefined) continue;
      parts.push('"' + k + '":' + __stableStringify(vars[k]));
    }
    return "{" + parts.join(",") + "}";
  };
};
`;

  /** Emit one PlanField object (and its children) */
  const lines: string[] = [];
  lines.push(helpers);

  // Emit fields bottom-up to satisfy reference order.
  const emitted = new Set<PlanField>();
  const emitField = (f: PlanField, parentTypename: string) => {
    if (emitted.has(f)) return;
    if (f.selectionSet) {
      for (const c of f.selectionSet) emitField(c, f.typeCondition || parentTypename);
    }

    const v = fieldVar.get(f)!;
    const spec = JSON.stringify(buildArgSpec(f));
    const expected = JSON.stringify(f.expectedArgNames || []);
    const selVar = `${v}_children`;
    const mapVar = `${v}_map`;
    const buildVar = `${v}_build`;
    const strVar = `${v}_str`;

    // children array & map (map uses the same objects to preserve identity)
    lines.push(`const ${selVar} = [${(f.selectionSet || []).map(c => fieldVar.get(c)).join(",")}];`);
    lines.push(`const ${mapVar} = __indexByResponseKey(${selVar});`);
    // arg builders
    lines.push(`const ${buildVar} = __makeBuildArgs(${spec});`);
    lines.push(`const ${strVar} = __makeStringifyArgs(${buildVar}, ${expected});`);
    // the field itself
    lines.push(
      `const ${v} = {` +
        `responseKey:${JSON.stringify(f.responseKey)},` +
        `fieldName:${JSON.stringify(f.fieldName)},` +
        `selectionSet:${selVar}.length?${selVar}:null,` +
        `selectionMap:${selVar}.length?${mapVar}:undefined,` +
        `buildArgs:${buildVar},` +
        `stringifyArgs:${strVar},` +
        `expectedArgNames:${expected},` +
        `isConnection:${!!f.isConnection},` +
        `connectionKey:${f.connectionKey ? JSON.stringify(f.connectionKey) : "undefined"},` +
        `connectionFilters:${f.connectionFilters ? JSON.stringify(f.connectionFilters) : "undefined"},` +
        `connectionMode:${f.connectionMode ? JSON.stringify(f.connectionMode) : "undefined"},` +
        `typeCondition:${f.typeCondition ? JSON.stringify(f.typeCondition) : "undefined"},` +
        `pageArgs:${f.pageArgs ? JSON.stringify(f.pageArgs) : "undefined"},` +
        `selId:${JSON.stringify(f.selId)}` +
      `};`,
    );

    emitted.add(f);
  };

  for (const f of plan.root) emitField(f, plan.rootTypename);

  // root arrays & maps
  const rootNames = plan.root.map(f => fieldVar.get(f)).join(",");
  lines.push(`const __root = [${rootNames}];`);
  lines.push(`const __rootMap = __indexByResponseKey(__root);`);

  // dep fields array referencing emitted field variables
  const depsArr = "[" + depItems.map(d => `{field:${d.varName},isConnection:${d.isConnection},parentTypename:${JSON.stringify(d.parentTypename)}}`).join(",") + "]";
  lines.push(`const __depFields = ${depsArr};`);

  // var masks + key fns
  const strictMask = JSON.stringify(plan.varMask.strict || []);
  const canonicalMask = JSON.stringify(plan.varMask.canonical || []);
  lines.push(`const __internalMakeVarsKey = __makeMaskedVarsKeyFn(${strictMask}, ${canonicalMask});`);
  lines.push(`const __makeVarsKey = (canonical, vars) => __internalMakeVarsKey(canonical ? "canonical" : "strict", vars);`);
  lines.push(
    `const __makeSignature = (canonical, vars) => ${JSON.stringify(plan.id)} + "|" + (canonical ? "canonical" : "strict") + "|" + __internalMakeVarsKey(canonical ? "canonical" : "strict", vars);`,
  );

  // getDependencies
  lines.push(`
const __getDependencies = (canonical, vars) => {
  const out = new Set();
  for (let i = 0; i < __depFields.length; i++) {
    const { field, isConnection, parentTypename } = __depFields[i];
    const parentId = parentTypename === ${JSON.stringify(plan.rootTypename)} ? "@" : parentTypename;
    if (isConnection) {
      out.add(canonical ? __buildConnectionCanonicalKey(field, parentId, vars)
                        : __buildConnectionKey(field, parentId, vars));
    } else {
      out.add(__buildFieldKey(field, vars));
    }
  }
  return out;
};`);

  // window args
  const windowArgs = Array.from(plan.windowArgs || new Set<string>());

  // Final plan object + export
  lines.push(`
const __plan = {
  kind: "CachePlan",
  operation: ${JSON.stringify(plan.operation)},
  rootTypename: ${JSON.stringify(plan.rootTypename)},
  root: __root,
  rootSelectionMap: __rootMap,
  networkQuery: ${JSON.stringify(plan.networkQuery)},
  id: ${JSON.stringify(plan.id)},
  varMask: { strict: ${strictMask}, canonical: ${canonicalMask} },
  makeVarsKey: __makeVarsKey,
  makeSignature: __makeSignature,
  getDependencies: __getDependencies,
  windowArgs: new Set(${JSON.stringify(windowArgs)}),
  selectionFingerprint: ${JSON.stringify(plan.selectionFingerprint)},
};

export default __plan;
`);

  return lines.join("\n");
}


export function createVueCachebayUserProfileApp(
  cachePolicy: "network-only" | "cache-first" | "cache-and-network" = "cache-first",
  delayMs = 0,
  sharedYoga?: any, // Optional shared Yoga instance
): VueCachebayUserProfileController {
  // Use shared Yoga instance if provided, otherwise create new one
  const yoga = sharedYoga || createUserProfileYoga(makeUserProfileDataset({ userCount: 1000 }), delayMs);

  const deferred = createDeferred();

  // Transport calls Yoga's fetch directly - no HTTP, no network, no serialization
  const transport = {
    http: async (context: any) => {
      // Use Yoga's fetch API (works in-memory without HTTP)
      const response = await yoga.fetch('http://localhost/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: context.query,
          variables: context.variables,
        }),
      });

      const result = await response.json();
      // console.log('[Cachebay]', context.variables?.id, '→', result.data?.user?.email || 'NO DATA');

      return {
        data: result.data || null,
        error: result.errors?.[0] || null
      };
    },
  };

  const plugin = createCachebay({
    hydrationTimeout: 0,
    suspensionTimeout: 0,
    transport,
  });


 const p = plugin.getPlan(USER_QUERY)
 // console.log(p)
 // console.log(serJs(p))

 //console.log();
 //console.log();
 //console.log();
 //console.log();
//
//console.log(emitCachePlanModule(p))
//console.log();
//console.log();
//console.log();
//console.log();

  let app: any = null;
  let componentInstance: any = null;

  const Component = defineComponent({
    setup() {
      const { data, error } = useQuery({
        query: __plan,
        variables: { id: 'u1' },
        cachePolicy,
        lazy: false,
      });

      watch(data, () => {
        if (data.value?.user) {
          // console.log('[Cachebay]', data.value.user.id, '→', data.value.user.email);
          deferred.resolve();
        }
      }, { immediate: true });

      watch(error, () => {
        if (error.value) {
          // console.log('[Cachebay] ERROR:', error.value);
        }
      });

      return {
        data,
        error,
      };
    },
    template: `
      <div>
        <div v-if="error" class="error">{{ error.message }}</div>
        <div v-if="data?.user" class="user">
          <div class="user-name">{{ data.user.name }}</div>
          <div class="user-email">{{ data.user.email }}</div>
          <div class="user-username">{{ data.user.username }}</div>
          <div class="user-phone">{{ data.user.phone }}</div>
          <div class="user-website">{{ data.user.website }}</div>
          <div class="user-company">{{ data.user.company }}</div>
          <div class="user-bio">{{ data.user.bio }}</div>
          <div class="user-avatar">{{ data.user.avatar }}</div>
          <div class="user-created">{{ data.user.createdAt }}</div>
          <div v-if="data.user.profile" class="profile">
            <div class="profile-bio">{{ data.user.profile.bio }}</div>
            <div class="profile-location">{{ data.user.profile.location }}</div>
            <div class="profile-website">{{ data.user.profile.website }}</div>
            <div class="profile-twitter">{{ data.user.profile.twitter }}</div>
            <div class="profile-github">{{ data.user.profile.github }}</div>
            <div class="profile-linkedin">{{ data.user.profile.linkedin }}</div>
            <div class="profile-followers">{{ data.user.profile.followers }}</div>
            <div class="profile-following">{{ data.user.profile.following }}</div>
          </div>
        </div>
      </div>
    `,
  });

  return {
    mount: (target?: Element) => {
      app = createApp(Component);
      app.use(plugin);

      const container = target || document.createElement("div");
      componentInstance = app.mount(container);
    },

    unmount: () => {
      if (app) {
        app.unmount();
        app = null;
        componentInstance = null;
      }
    },

    ready: async () => {
      // Wait for query to complete
      await deferred.promise;
    },
  };
}
