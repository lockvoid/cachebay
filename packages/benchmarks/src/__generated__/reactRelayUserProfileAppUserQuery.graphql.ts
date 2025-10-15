/**
 * @generated SignedSource<<9f3ad5d5431d6330a2364a4ec114b892>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest, Query } from 'relay-runtime';
export type reactRelayUserProfileAppUserQuery$variables = {
  id: string;
};
export type reactRelayUserProfileAppUserQuery$data = {
  readonly user: {
    readonly avatar: string;
    readonly bio: string;
    readonly company: string;
    readonly createdAt: string;
    readonly email: string;
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly profile: {
      readonly avatar: string;
      readonly bio: string;
      readonly followers: number;
      readonly following: number;
      readonly github: string;
      readonly id: string;
      readonly linkedin: string;
      readonly location: string;
      readonly twitter: string;
      readonly website: string;
    };
    readonly username: string;
    readonly website: string;
  } | null | undefined;
};
export type reactRelayUserProfileAppUserQuery = {
  response: reactRelayUserProfileAppUserQuery$data;
  variables: reactRelayUserProfileAppUserQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "id"
  }
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "website",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "bio",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "avatar",
  "storageKey": null
},
v5 = [
  {
    "alias": null,
    "args": [
      {
        "kind": "Variable",
        "name": "id",
        "variableName": "id"
      }
    ],
    "concreteType": "User",
    "kind": "LinkedField",
    "name": "user",
    "plural": false,
    "selections": [
      (v1/*: any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "name",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "email",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "username",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "phone",
        "storageKey": null
      },
      (v2/*: any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "company",
        "storageKey": null
      },
      (v3/*: any*/),
      (v4/*: any*/),
      {
        "alias": null,
        "args": null,
        "kind": "ScalarField",
        "name": "createdAt",
        "storageKey": null
      },
      {
        "alias": null,
        "args": null,
        "concreteType": "Profile",
        "kind": "LinkedField",
        "name": "profile",
        "plural": false,
        "selections": [
          (v1/*: any*/),
          (v3/*: any*/),
          (v4/*: any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "location",
            "storageKey": null
          },
          (v2/*: any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "twitter",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "github",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "linkedin",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "followers",
            "storageKey": null
          },
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "following",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ],
    "storageKey": null
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "reactRelayUserProfileAppUserQuery",
    "selections": (v5/*: any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Operation",
    "name": "reactRelayUserProfileAppUserQuery",
    "selections": (v5/*: any*/)
  },
  "params": {
    "cacheID": "bf423b1d04d43f254e579418578c28ef",
    "id": null,
    "metadata": {},
    "name": "reactRelayUserProfileAppUserQuery",
    "operationKind": "query",
    "text": "query reactRelayUserProfileAppUserQuery(\n  $id: ID!\n) {\n  user(id: $id) {\n    id\n    name\n    email\n    username\n    phone\n    website\n    company\n    bio\n    avatar\n    createdAt\n    profile {\n      id\n      bio\n      avatar\n      location\n      website\n      twitter\n      github\n      linkedin\n      followers\n      following\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "4382106325df54e63d49e7ee4cd3991a";

export default node;
