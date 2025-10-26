/**
 * @generated SignedSource<<187414cca4e3381fb96c9472d765dc89>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest, Query } from 'relay-runtime';
export type apiRelayQuery$variables = {
  after?: string | null | undefined;
  first: number;
};
export type apiRelayQuery$data = {
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
    };
  };
};
export type apiRelayQuery = {
  response: apiRelayQuery$data;
  variables: apiRelayQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "after"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "first"
},
v2 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "cursor",
  "storageKey": null
},
v3 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "id",
  "storageKey": null
},
v4 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "name",
  "storageKey": null
},
v5 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "avatar",
  "storageKey": null
},
v6 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "title",
  "storageKey": null
},
v7 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "likeCount",
  "storageKey": null
},
v8 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "__typename",
  "storageKey": null
},
v9 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "hasNextPage",
  "storageKey": null
},
v10 = {
  "alias": null,
  "args": null,
  "kind": "ScalarField",
  "name": "endCursor",
  "storageKey": null
},
v11 = {
  "alias": null,
  "args": null,
  "concreteType": "PageInfo",
  "kind": "LinkedField",
  "name": "pageInfo",
  "plural": false,
  "selections": [
    (v9/*: any*/),
    (v10/*: any*/)
  ],
  "storageKey": null
},
v12 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "CommentEdge",
    "kind": "LinkedField",
    "name": "edges",
    "plural": true,
    "selections": [
      (v2/*: any*/),
      {
        "alias": null,
        "args": null,
        "concreteType": "Comment",
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v3/*: any*/),
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
              (v3/*: any*/),
              (v4/*: any*/)
            ],
            "storageKey": null
          },
          (v8/*: any*/)
        ],
        "storageKey": null
      }
    ],
    "storageKey": null
  },
  (v11/*: any*/)
],
v13 = {
  "alias": null,
  "args": null,
  "concreteType": "PageInfo",
  "kind": "LinkedField",
  "name": "pageInfo",
  "plural": false,
  "selections": [
    (v10/*: any*/),
    (v9/*: any*/)
  ],
  "storageKey": null
},
v14 = [
  {
    "kind": "Variable",
    "name": "after",
    "variableName": "after"
  },
  {
    "kind": "Variable",
    "name": "first",
    "variableName": "first"
  }
],
v15 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 5
  }
],
v16 = [
  {
    "kind": "Literal",
    "name": "first",
    "value": 3
  }
],
v17 = {
  "count": null,
  "cursor": null,
  "direction": "forward",
  "path": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*: any*/),
      (v1/*: any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "apiRelayQuery",
    "selections": [
      {
        "alias": "users",
        "args": null,
        "concreteType": "UserConnection",
        "kind": "LinkedField",
        "name": "__api_users_connection",
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
              (v2/*: any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "User",
                "kind": "LinkedField",
                "name": "node",
                "plural": false,
                "selections": [
                  (v3/*: any*/),
                  (v4/*: any*/),
                  (v5/*: any*/),
                  {
                    "alias": "posts",
                    "args": null,
                    "concreteType": "PostConnection",
                    "kind": "LinkedField",
                    "name": "__User_posts_connection",
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
                          (v2/*: any*/),
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "Post",
                            "kind": "LinkedField",
                            "name": "node",
                            "plural": false,
                            "selections": [
                              (v3/*: any*/),
                              (v6/*: any*/),
                              (v7/*: any*/),
                              {
                                "alias": "comments",
                                "args": null,
                                "concreteType": "CommentConnection",
                                "kind": "LinkedField",
                                "name": "__Post_comments_connection",
                                "plural": false,
                                "selections": (v12/*: any*/),
                                "storageKey": null
                              },
                              (v8/*: any*/)
                            ],
                            "storageKey": null
                          }
                        ],
                        "storageKey": null
                      },
                      (v11/*: any*/)
                    ],
                    "storageKey": null
                  },
                  (v8/*: any*/)
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          },
          (v13/*: any*/)
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*: any*/),
      (v0/*: any*/)
    ],
    "kind": "Operation",
    "name": "apiRelayQuery",
    "selections": [
      {
        "alias": null,
        "args": (v14/*: any*/),
        "concreteType": "UserConnection",
        "kind": "LinkedField",
        "name": "users",
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
              (v2/*: any*/),
              {
                "alias": null,
                "args": null,
                "concreteType": "User",
                "kind": "LinkedField",
                "name": "node",
                "plural": false,
                "selections": [
                  (v3/*: any*/),
                  (v4/*: any*/),
                  (v5/*: any*/),
                  {
                    "alias": null,
                    "args": (v15/*: any*/),
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
                          (v2/*: any*/),
                          {
                            "alias": null,
                            "args": null,
                            "concreteType": "Post",
                            "kind": "LinkedField",
                            "name": "node",
                            "plural": false,
                            "selections": [
                              (v3/*: any*/),
                              (v6/*: any*/),
                              (v7/*: any*/),
                              {
                                "alias": null,
                                "args": (v16/*: any*/),
                                "concreteType": "CommentConnection",
                                "kind": "LinkedField",
                                "name": "comments",
                                "plural": false,
                                "selections": (v12/*: any*/),
                                "storageKey": "comments(first:3)"
                              },
                              {
                                "alias": null,
                                "args": (v16/*: any*/),
                                "filters": null,
                                "handle": "connection",
                                "key": "Post_comments",
                                "kind": "LinkedHandle",
                                "name": "comments"
                              },
                              (v8/*: any*/)
                            ],
                            "storageKey": null
                          }
                        ],
                        "storageKey": null
                      },
                      (v11/*: any*/)
                    ],
                    "storageKey": "posts(first:5)"
                  },
                  {
                    "alias": null,
                    "args": (v15/*: any*/),
                    "filters": null,
                    "handle": "connection",
                    "key": "User_posts",
                    "kind": "LinkedHandle",
                    "name": "posts"
                  },
                  (v8/*: any*/)
                ],
                "storageKey": null
              }
            ],
            "storageKey": null
          },
          (v13/*: any*/)
        ],
        "storageKey": null
      },
      {
        "alias": null,
        "args": (v14/*: any*/),
        "filters": null,
        "handle": "connection",
        "key": "api_users",
        "kind": "LinkedHandle",
        "name": "users"
      }
    ]
  },
  "params": {
    "cacheID": "83dab18ec85b7a397ebc8cf67be2536b",
    "id": null,
    "metadata": {
      "connection": [
        (v17/*: any*/),
        (v17/*: any*/),
        {
          "count": "first",
          "cursor": "after",
          "direction": "forward",
          "path": [
            "users"
          ]
        }
      ]
    },
    "name": "apiRelayQuery",
    "operationKind": "query",
    "text": "query apiRelayQuery(\n  $first: Int!\n  $after: String\n) {\n  users(first: $first, after: $after) {\n    edges {\n      cursor\n      node {\n        id\n        name\n        avatar\n        posts(first: 5) {\n          edges {\n            cursor\n            node {\n              id\n              title\n              likeCount\n              comments(first: 3) {\n                edges {\n                  cursor\n                  node {\n                    id\n                    text\n                    author {\n                      id\n                      name\n                    }\n                    __typename\n                  }\n                }\n                pageInfo {\n                  hasNextPage\n                  endCursor\n                }\n              }\n              __typename\n            }\n          }\n          pageInfo {\n            hasNextPage\n            endCursor\n          }\n        }\n        __typename\n      }\n    }\n    pageInfo {\n      endCursor\n      hasNextPage\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "ddb0155d31d1529981603652045078e3";

export default node;
