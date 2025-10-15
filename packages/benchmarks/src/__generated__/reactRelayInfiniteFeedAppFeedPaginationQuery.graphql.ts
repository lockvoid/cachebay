/**
 * @generated SignedSource<<4f7025981ad3829746b17658dee3b64b>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest, Query } from 'relay-runtime';
import { FragmentRefs } from "relay-runtime";
export type reactRelayInfiniteFeedAppFeedPaginationQuery$variables = {
  count: number;
  cursor?: string | null | undefined;
};
export type reactRelayInfiniteFeedAppFeedPaginationQuery$data = {
  readonly " $fragmentSpreads": FragmentRefs<"reactRelayInfiniteFeedApp_FeedList_query">;
};
export type reactRelayInfiniteFeedAppFeedPaginationQuery = {
  response: reactRelayInfiniteFeedAppFeedPaginationQuery$data;
  variables: reactRelayInfiniteFeedAppFeedPaginationQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = [
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
v1 = [
  {
    "kind": "Variable",
    "name": "after",
    "variableName": "cursor"
  },
  {
    "kind": "Variable",
    "name": "first",
    "variableName": "count"
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "reactRelayInfiniteFeedAppFeedPaginationQuery",
    "selections": [
      {
        "args": [
          {
            "kind": "Variable",
            "name": "count",
            "variableName": "count"
          },
          {
            "kind": "Variable",
            "name": "cursor",
            "variableName": "cursor"
          }
        ],
        "kind": "FragmentSpread",
        "name": "reactRelayInfiniteFeedApp_FeedList_query"
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Operation",
    "name": "reactRelayInfiniteFeedAppFeedPaginationQuery",
    "selections": [
      {
        "alias": null,
        "args": (v1/*: any*/),
        "concreteType": "FeedConnection",
        "kind": "LinkedField",
        "name": "feed",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "concreteType": "FeedEdge",
            "kind": "LinkedField",
            "name": "edges",
            "plural": true,
            "selections": [
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "cursor",
                "storageKey": null
              },
              {
                "alias": null,
                "args": null,
                "concreteType": "Post",
                "kind": "LinkedField",
                "name": "node",
                "plural": false,
                "selections": [
                  {
                    "alias": null,
                    "args": null,
                    "kind": "ScalarField",
                    "name": "id",
                    "storageKey": null
                  },
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
              {
                "alias": null,
                "args": null,
                "kind": "ScalarField",
                "name": "hasNextPage",
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
        "args": (v1/*: any*/),
        "filters": null,
        "handle": "connection",
        "key": "FeedList_feed",
        "kind": "LinkedHandle",
        "name": "feed"
      }
    ]
  },
  "params": {
    "cacheID": "26c4d3f07360a932abd3180365e5e8e0",
    "id": null,
    "metadata": {},
    "name": "reactRelayInfiniteFeedAppFeedPaginationQuery",
    "operationKind": "query",
    "text": "query reactRelayInfiniteFeedAppFeedPaginationQuery(\n  $count: Int!\n  $cursor: String\n) {\n  ...reactRelayInfiniteFeedApp_FeedList_query_1G22uz\n}\n\nfragment reactRelayInfiniteFeedApp_FeedList_query_1G22uz on Query {\n  feed(first: $count, after: $cursor) {\n    edges {\n      cursor\n      node {\n        id\n        title\n        __typename\n      }\n    }\n    pageInfo {\n      startCursor\n      endCursor\n      hasPreviousPage\n      hasNextPage\n    }\n  }\n}\n"
  }
};
})();

(node as any).hash = "58eeb002a08e0f799cf5ffbd2272218d";

export default node;
