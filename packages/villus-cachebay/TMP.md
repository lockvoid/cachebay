{
  // ———————————————————————————————————————————————————————————————
  // ENTITIES (identifiable objects)
  // ———————————————————————————————————————————————————————————————
  "Post:p1": { __typename: "VideoPost", id: "p1", title: "Video 1", flags: [], video: { __ref: "Media:m1" } },
  "Post:p2": { __typename: "AudioPost", id: "p2", title: "Audio 2", flags: [], audio: { __ref: "Media:m2" } },

  "Media:m1": { __typename: "Media", key: "m1", mediaUrl: "https://m/1" },
  "Media:m2": { __typename: "Media", key: "m2", mediaUrl: "https://m/2" },

  "Tag:t1":  { __typename: "Tag", id: "t1",  name: "mod-1" },
  "Tag:t2":  { __typename: "Tag", id: "t2",  name: "mod-2" },
  "Tag:tu1": { __typename: "Tag", id: "tu1", name: "user-1" },
  "Tag:tu2": { __typename: "Tag", id: "tu2", name: "user-2" },

  "Stat:today":     { __typename: "Stat", key: "today",     views: 123 },
  "Stat:yesterday": { __typename: "Stat", key: "yesterday", views: 95 },

  // ———————————————————————————————————————————————————————————————
  // CONCRETE ROOT POSTS PAGE (exact server page)
  // ———————————————————————————————————————————————————————————————
  '@.posts({"after":null,"first":2})': {
    __typename: "PostConnection",
    totalCount: 2,
    edges:     { __ref: '@.posts({"after":null,"first":2}).edges' },
    pageInfo:  { __ref: '@.posts({"after":null,"first":2}).pageInfo' },
    aggregations: { __ref: '@.posts({"after":null,"first":2}).aggregations' }
  },
  '@.posts({"after":null,"first":2})::meta': {
    mode: "page", anchor: "after" // example meta; shape is up to you
  },

  // Concrete edges list (pure refs)
  '@.posts({"after":null,"first":2}).edges': {
    __refs: [
      '@.posts({"after":null,"first":2}).edges:0',
      '@.posts({"after":null,"first":2}).edges:1'
    ]
  },
  '@.posts({"after":null,"first":2}).edges:0': {
    __typename: "PostEdge", cursor: "p1", node: { __ref: "Post:p1" }
  },
  '@.posts({"after":null,"first":2}).edges:1': {
    __typename: "PostEdge", cursor: "p2", node: { __ref: "Post:p2" }
  },

  // Concrete pageInfo
  '@.posts({"after":null,"first":2}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "p1",
    endCursor:   "p2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // Concrete ROOT aggregations container
  '@.posts({"after":null,"first":2}).aggregations': {
    __typename: "Aggregations",
    scoring: 88, // scalars live here (concrete), not in canonical
    'stat({"key":"today"})':     { __ref: "Stat:today" },
    'stat({"key":"yesterday"})': { __ref: "Stat:yesterday" },
    'tags({"first":50})': {
      __ref: '@.posts({"after":null,"first":2}).aggregations.tags({"first":50})'
    }
  },

  // Concrete ROOT aggregations.tags page
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50})': {
    __typename: "TagConnection",
    edges:    { __ref: '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges' },
    pageInfo: { __ref: '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).pageInfo' }
  },
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50})::meta': {
    mode: "page"
  },
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges': {
    __refs: [
      '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0',
      '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1'
    ]
  },
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0': {
    __typename: "TagEdge", node: { __ref: "Tag:t1" }
  },
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1': {
    __typename: "TagEdge", node: { __ref: "Tag:t2" }
  },
  '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "t1",
    endCursor:   "t2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // ———————————————————————————————————————————————————————————————
  // CONCRETE PER-NODE AGGREGATIONS (p1)
  // ———————————————————————————————————————————————————————————————
  'Post:p1.aggregations': {
    __typename: "Aggregations",
    'tags({"category":"moderation","first":25})': {
      __ref: '@.Post:p1.aggregations.tags({"category":"moderation","first":25})'
    },
    'tags({"category":"user","first":25})': {
      __ref: '@.Post:p1.aggregations.tags({"category":"user","first":25})'
    }
  },

  '@.Post:p1.aggregations.tags({"category":"moderation","first":25})': {
    __typename: "TagConnection",
    edges:    { __ref: '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges' },
    pageInfo: { __ref: '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).pageInfo' }
  },
  '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges': {
    __refs: ['@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0']
  },
  '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0': {
    __typename: "TagEdge", node: { __ref: "Tag:t1" }
  },
  '@.Post:p1.aggregations.tags({"category":"moderation","first":25}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "t1",
    endCursor:   "t1",
    hasNextPage: false,
    hasPreviousPage: false
  },

  '@.Post:p1.aggregations.tags({"category":"user","first":25})': {
    __typename: "TagConnection",
    edges:    { __ref: '@.Post:p1.aggregations.tags({"category":"user","first":25}).edges' },
    pageInfo: { __ref: '@.Post:p1.aggregations.tags({"category":"user","first":25}).pageInfo' }
  },
  '@.Post:p1.aggregations.tags({"category":"user","first":25}).edges': {
    __refs: ['@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0']
  },
  '@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0': {
    __typename: "TagEdge", node: { __ref: "Tag:tu1" }
  },
  '@.Post:p1.aggregations.tags({"category":"user","first":25}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "tu1",
    endCursor:   "tu1",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // ———————————————————————————————————————————————————————————————
  // CONCRETE PER-NODE AGGREGATIONS (p2)
  // ———————————————————————————————————————————————————————————————
  'Post:p2.aggregations': {
    __typename: "Aggregations",
    'tags({"category":"moderation","first":25})': {
      __ref: '@.Post:p2.aggregations.tags({"category":"moderation","first":25})'
    },
    'tags({"category":"user","first":25})': {
      __ref: '@.Post:p2.aggregations.tags({"category":"user","first":25})'
    }
  },

  '@.Post:p2.aggregations.tags({"category":"moderation","first":25})': {
    __typename: "TagConnection",
    edges:    { __ref: '@.Post:p2.aggregations.tags({"category":"moderation","first":25}).edges' },
    pageInfo: { __ref: '@.Post:p2.aggregations.tags({"category":"moderation","first":25}).pageInfo' }
  },
  '@.Post:p2.aggregations.tags({"category":"moderation","first":25}).edges': {
    __refs: ['@.Post:p2.aggregations.tags({"category":"moderation","first":25}).edges:0']
  },
  '@.Post:p2.aggregations.tags({"category":"moderation","first":25}).edges:0': {
    __typename: "TagEdge", node: { __ref: "Tag:t2" }
  },
  '@.Post:p2.aggregations.tags({"category":"moderation","first":25}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "t2",
    endCursor:   "t2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  '@.Post:p2.aggregations.tags({"category":"user","first":25})': {
    __typename: "TagConnection",
    edges:    { __ref: '@.Post:p2.aggregations.tags({"category":"user","first":25}).edges' },
    pageInfo: { __ref: '@.Post:p2.aggregations.tags({"category":"user","first":25}).pageInfo' }
  },
  '@.Post:p2.aggregations.tags({"category":"user","first":25}).edges': {
    __refs: ['@.Post:p2.aggregations.tags({"category":"user","first":25}).edges:0']
  },
  '@.Post:p2.aggregations.tags({"category":"user","first":25}).edges:0': {
    __typename: "TagEdge", node: { __ref: "Tag:tu2" }
  },
  '@.Post:p2.aggregations.tags({"category":"user","first":25}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "tu2",
    endCursor:   "tu2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // ———————————————————————————————————————————————————————————————
  // CANONICAL PARENT CONNECTION (filters-only identity)
  // ———————————————————————————————————————————————————————————————
  '@connection.posts({})': {
    __typename: "PostConnection",
    totalCount: 2,
    edges:     { __ref: '@connection.posts({}).edges' },
    pageInfo:  { __ref: '@connection.posts({}).pageInfo' },
    aggregations: { __ref: '@connection.posts({}).aggregations' }
  },
  '@connection.posts({})::meta': {
    policy: "page", filters: {}
  },
  '@connection.posts({}).edges': {
    __refs: [
      // canonical view points at concrete edge records
      '@.posts({"after":null,"first":2}).edges:0',
      '@.posts({"after":null,"first":2}).edges:1'
    ]
  },
  '@connection.posts({}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "p1",
    endCursor:   "p2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // Canonical aggregations VIEW for the parent canonical
  '@connection.posts({}).aggregations': {
    __typename: "Aggregations",
    totalCount: 2,
    'stat({"key":"today"})':     { __ref: 'Stat:today' },
    'stat({"key":"yesterday"})': { __ref: 'Stat:yesterday' },
    // nested canonical connection
    'BaseTags({})': { __ref: '@connection.posts({}).aggregations.BaseTags({})' }
  },

  // Canonical nested connection (root aggregations.BaseTags)
  '@connection.posts({}).aggregations.BaseTags({})': {
    __typename: "TagConnection",
    edges:    { __ref: '@connection.posts({}).aggregations.BaseTags({}).edges' },
    pageInfo: { __ref: '@connection.posts({}).aggregations.BaseTags({}).pageInfo' }
  },
  '@connection.posts({}).aggregations.BaseTags({}).edges': {
    __refs: [
      '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:0',
      '@.posts({"after":null,"first":2}).aggregations.tags({"first":50}).edges:1'
    ]
  },
  '@connection.posts({}).aggregations.BaseTags({}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "t1",
    endCursor:   "t2",
    hasNextPage: false,
    hasPreviousPage: false
  },

  // ———————————————————————————————————————————————————————————————
  // OPTIONAL: CANONICALS for per-node alias connections
  // ———————————————————————————————————————————————————————————————
  '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"})': {
    __typename: "TagConnection",
    edges:    { __ref: '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"}).edges' },
    pageInfo: { __ref: '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"}).pageInfo' }
  },
  '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"}).edges': {
    __refs: ['@.Post:p1.aggregations.tags({"category":"moderation","first":25}).edges:0']
  },
  '@connection.Post:p1.aggregations.ModerationTags({"category":"moderation"}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "t1",
    endCursor:   "t1",
    hasNextPage: false,
    hasPreviousPage: false
  },

  '@connection.Post:p1.aggregations.UserTags({"category":"user"})': {
    __typename: "TagConnection",
    edges:    { __ref: '@connection.Post:p1.aggregations.UserTags({"category":"user"}).edges' },
    pageInfo: { __ref: '@connection.Post:p1.aggregations.UserTags({"category":"user"}).pageInfo' }
  },
  '@connection.Post:p1.aggregations.UserTags({"category":"user"}).edges': {
    __refs: ['@.Post:p1.aggregations.tags({"category":"user","first":25}).edges:0']
  },
  '@connection.Post:p1.aggregations.UserTags({"category":"user"}).pageInfo': {
    __typename: "PageInfo",
    startCursor: "tu1",
    endCursor:   "tu1",
    hasNextPage: false,
    hasPreviousPage: false
  }

  // …analogous canonical keys for Post:p2 if needed
}
