/**
 * @generated SignedSource<<f10ef6e1d67d78e2e2ceb61fe6e8ecba>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ReaderFragment, RefetchableFragment } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type reactRelayNestedQueryApp_UsersList_query$data = {
  readonly users: {
    readonly edges: ReadonlyArray<{
      readonly cursor: string;
      readonly node: {
        readonly avatar: string;
        readonly id: string;
        readonly name: string;
        readonly posts: {
          readonly edges: ReadonlyArray<{
            readonly cursor: string;
            readonly node: {
              readonly comments: {
                readonly edges: ReadonlyArray<{
                  readonly cursor: string;
                  readonly node: {
                    readonly author: {
                      readonly id: string;
                      readonly name: string;
                    };
                    readonly id: string;
                    readonly text: string;
                  };
                }>;
                readonly pageInfo: {
                  readonly hasNextPage: boolean;
                };
              };
              readonly id: string;
              readonly likeCount: number;
              readonly title: string;
            };
          }>;
          readonly pageInfo: {
            readonly hasNextPage: boolean;
          };
        };
      };
    }>;
    readonly pageInfo: {
      readonly endCursor: string | null | undefined;
      readonly hasNextPage: boolean;
      readonly hasPreviousPage: boolean;
      readonly startCursor: string | null | undefined;
    };
  };
  readonly " $fragmentType": "reactRelayNestedQueryApp_UsersList_query";
};
export type reactRelayNestedQueryApp_UsersList_query$key = {
  readonly " $data"?: reactRelayNestedQueryApp_UsersList_query$data;
  readonly " $fragmentSpreads": FragmentRefs<"reactRelayNestedQueryApp_UsersList_query">;
};

import reactRelayNestedQueryAppUsersPaginationQuery_graphql from './reactRelayNestedQueryAppUsersPaginationQuery.graphql';

const node: ReaderFragment = (function(){
var v0 = [
  "users"
],
v1 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "hasNextPage",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "concreteType": "PageInfo",
  "kind": "LinkedField",
  "name": "pageInfo",
  "plural": false,
  "selections": [
    (v4/*: any*/)
  ],
  "storageKey": null
};
return {
  "argumentDefinitions": [
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "count"
    },
    {
      "defaultValue": null,
      "kind": "LocalArgument",
      "name": "cursor"
    }
  ],
  "kind": "Fragment",
  "metadata": {
    "connection": [
      {
        "count": "count",
        "cursor": "cursor",
        "direction": "forward",
        "path": (v0/*: any*/)
      }
    ],
    "refetch": {
      "connection": {
        "forward": {
          "count": "count",
          "cursor": "cursor"
        },
        "backward": null,
        "path": (v0/*: any*/)
      },
      "fragmentPathInResult": [],
      "operation": reactRelayNestedQueryAppUsersPaginationQuery_graphql
    }
  },
  "name": "reactRelayNestedQueryApp_UsersList_query",
  "selections": [
    {
      "alias": "users",
      "args": null,
      "concreteType": "UserConnection",
      "kind": "LinkedField",
      "name": "__UsersList_users_connection",
      "plural": false,
      "selections": [
        {
          "alias": null,
          "args": null,
          "concreteType": "UserEdge",
          "kind": "LinkedField",
          "name": "edges",
          "plural": true,
          "selections": [
            (v1/*: any*/),
            {
              "alias": null,
              "args": null,
              "concreteType": "User",
              "kind": "LinkedField",
              "name": "node",
              "plural": false,
              "selections": [
                (v2/*: any*/),
                (v3/*: any*/),
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "avatar",
                  "storageKey": null
                },
                {
                  "alias": null,
                  "args": [
                    {
                      "kind": "Literal",
                      "name": "first",
                      "value": 5
                    }
                  ],
                  "concreteType": "PostConnection",
                  "kind": "LinkedField",
                  "name": "posts",
                  "plural": false,
                  "selections": [
                    {
                      "alias": null,
                      "args": null,
                      "concreteType": "PostEdge",
                      "kind": "LinkedField",
                      "name": "edges",
                      "plural": true,
                      "selections": [
                        (v1/*: any*/),
                        {
                          "alias": null,
                          "args": null,
                          "concreteType": "Post",
                          "kind": "LinkedField",
                          "name": "node",
                          "plural": false,
                          "selections": [
                            (v2/*: any*/),
                            {
                              "alias": null,
                              "args": null,
                              "kind": "ScalarField",
                              "name": "title",
                              "storageKey": null
                            },
                            {
                              "alias": null,
                              "args": null,
                              "kind": "ScalarField",
                              "name": "likeCount",
                              "storageKey": null
                            },
                            {
                              "alias": null,
                              "args": [
                                {
                                  "kind": "Literal",
                                  "name": "first",
                                  "value": 3
                                }
                              ],
                              "concreteType": "CommentConnection",
                              "kind": "LinkedField",
                              "name": "comments",
                              "plural": false,
                              "selections": [
                                {
                                  "alias": null,
                                  "args": null,
                                  "concreteType": "CommentEdge",
                                  "kind": "LinkedField",
                                  "name": "edges",
                                  "plural": true,
                                  "selections": [
                                    (v1/*: any*/),
                                    {
                                      "alias": null,
                                      "args": null,
                                      "concreteType": "Comment",
                                      "kind": "LinkedField",
                                      "name": "node",
                                      "plural": false,
                                      "selections": [
                                        (v2/*: any*/),
                                        {
                                          "alias": null,
                                          "args": null,
                                          "kind": "ScalarField",
                                          "name": "text",
                                          "storageKey": null
                                        },
                                        {
                                          "alias": null,
                                          "args": null,
                                          "concreteType": "User",
                                          "kind": "LinkedField",
                                          "name": "author",
                                          "plural": false,
                                          "selections": [
                                            (v2/*: any*/),
                                            (v3/*: any*/)
                                          ],
                                          "storageKey": null
                                        }
                                      ],
                                      "storageKey": null
                                    }
                                  ],
                                  "storageKey": null
                                },
                                (v5/*: any*/)
                              ],
                              "storageKey": "comments(first:3)"
                            }
                          ],
                          "storageKey": null
                        }
                      ],
                      "storageKey": null
                    },
                    (v5/*: any*/)
                  ],
                  "storageKey": "posts(first:5)"
                },
                {
                  "alias": null,
                  "args": null,
                  "kind": "ScalarField",
                  "name": "__typename",
                  "storageKey": null
                }
              ],
              "storageKey": null
            }
          ],
          "storageKey": null
        },
        {
          "alias": null,
          "args": null,
          "concreteType": "PageInfo",
          "kind": "LinkedField",
          "name": "pageInfo",
          "plural": false,
          "selections": [
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "startCursor",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "endCursor",
              "storageKey": null
            },
            {
              "alias": null,
              "args": null,
              "kind": "ScalarField",
              "name": "hasPreviousPage",
              "storageKey": null
            },
            (v4/*: any*/)
          ],
          "storageKey": null
        }
      ],
      "storageKey": null
    }
  ],
  "type": "Query",
  "abstractKey": null
};
})();

(node as any).hash = "4775efdea836d3ecde22d3238d3ae8ca";

export default node;
