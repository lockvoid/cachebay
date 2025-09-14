// test/unit/core/fragments.test.ts
import { describe, it, expect } from 'vitest';
import { isReactive } from 'vue';
import { createGraph, type GraphAPI } from '@/src/core/graph';
import { createSelections } from '@/src/core/selections';
import { createFragments } from '@/src/core/fragments';

function makeGraph(): GraphAPI {
  return createGraph({
    reactiveMode: 'shallow',
    keys: {
      User: (o) => o?.id ?? null,
      Profile: (o) => o?.id ?? null,
      Post: (o) => o?.id ?? null,       // canonical interface key
      AudioPost: (o) => o?.id ?? null,
      VideoPost: (o) => o?.id ?? null,
      Comment: (o) => o?.id ?? null,
      PageInfo: () => null,
      PostEdge: () => null,
    },
    interfaces: { Post: ['AudioPost', 'VideoPost'] },
  });
}

describe('fragments.ts — readFragment/writeFragment (GraphQL fragments)', () => {
  it('writes and reads a simple entity fragment (User)', async () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

    // seed minimal user via fragment write
    writeFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserBasics on User {
          id
          name
          email
        }
      `,
      data: {
        __typename: 'User',
        id: '1',
        name: 'Ada',
        email: 'ada@example.com',
      },
    });

    // read it back
    const result = readFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserBasics on User {
          id
          name
          email
        }
      `,
    });

    expect(result).toEqual({
      __typename: 'User',
      id: '1',
      name: 'Ada',
      email: 'ada@example.com',
    });

    // materialize proxy and ensure it’s reactive and reflects updates
    const userProxy = graph.materializeEntity('User:1');
    expect(isReactive(userProxy)).toBe(true);
    expect(userProxy.name).toBe('Ada');

    // update via fragment write (partial)
    writeFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserNameOnly on User {
          name
        }
      `,
      data: { __typename: 'User', id: '1', name: 'Ada Lovelace' },
    });

    // proxy reflects change
    expect(userProxy.name).toBe('Ada Lovelace');

    // read back with larger fragment still sees merged state
    const again = readFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserBasics on User {
          id
          name
          email
        }
      `,
    });
    expect(again).toEqual({
      __typename: 'User',
      id: '1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  it('handles interface implementors: AudioPost/VideoPost → canonical Post:1, latest implementor visible', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

    // First write: AudioPost → canonical key is Post:1
    writeFragment({
      id: 'Post:1',
      fragment: /* GraphQL */ `
        fragment AudioMeta on AudioPost {
          id
          title
          bitrate
        }
      `,
      data: {
        __typename: 'AudioPost',
        id: '1',
        title: 'Audio A',
        bitrate: 320,
      },
    });

    // Second write for same id but different implementor
    writeFragment({
      id: 'Post:1',
      fragment: /* GraphQL */ `
        fragment VideoMeta on VideoPost {
          id
          title
          duration
        }
      `,
      data: {
        __typename: 'VideoPost',
        id: '1',
        title: 'Video B',
        duration: 120,
      },
    });

    // materialize shows the latest implementor shape
    const postProxy = graph.materializeEntity('Post:1');
    expect(isReactive(postProxy)).toBe(true);
    expect(postProxy.__typename).toBe('VideoPost');
    expect(postProxy.title).toBe('Video B');
    expect(postProxy.duration).toBe(120);

    // read as a Post fragment (union-ish view)
    const readAsPost = readFragment({
      id: 'Post:1',
      fragment: /* GraphQL */ `
        fragment PostView on Post {
          id
          title
        }
      `,
    });
    expect(readAsPost).toMatchObject({ __typename: 'VideoPost', id: '1', title: 'Video B' });
  });

  it('writes & reads a nested field with args (connection page) via fragment', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

    // seed the parent entity
    graph.putEntity({
      __typename: 'User',
      id: '1',
      name: 'John',
      profile: { __typename: 'Profile', id: 'p1', bio: 'dev' },
    });

    // write connection page (first: 2) as a fragment on User
    writeFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges {
              __typename
              cursor
              node {
                __typename
                id
                title
              }
            }
            pageInfo {
              __typename
              hasNextPage
              endCursor
            }
          }
        }
      `,
      data: {
        __typename: 'User',
        id: '1',
        posts: {
          __typename: 'PostConnection',
          edges: [
            {
              __typename: 'PostEdge',
              cursor: 'c1',
              node: { __typename: 'Post', id: '101', title: 'Hello' },
            },
            {
              __typename: 'PostEdge',
              cursor: 'c2',
              node: { __typename: 'Post', id: '102', title: 'World' },
            },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: true, endCursor: 'c2' },
        },
      },
    });

    // read the same fragment back
    const out = readFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges {
              __typename
              cursor
              node {
                __typename
                id
                title
              }
            }
            pageInfo {
              __typename
              hasNextPage
              endCursor
            }
          }
        }
      `,
    });

    // structure is returned, nodes are resolved from normalized store
    expect(out.posts.__typename).toBe('PostConnection');
    expect(out.posts.edges.map((e: any) => e.node.id)).toEqual(['101', '102']);
    expect(out.posts.pageInfo).toEqual({
      __typename: 'PageInfo',
      hasNextPage: true,
      endCursor: 'c2',
    });

    // updating a post entity reflects in a fresh read
    graph.putEntity({ __typename: 'Post', id: '101', title: 'Hello (updated)' });
    const out2 = readFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserPostsPage on User {
          posts(first: 2) {
            edges { node { id title } }
            pageInfo { endCursor }
          }
        }
      `,
    });
    expect(out2.posts.edges[0].node.title).toBe('Hello (updated)');
  });
});
