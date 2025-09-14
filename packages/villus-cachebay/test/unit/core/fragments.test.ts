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

describe('fragments.ts — readFragment/writeFragment/watchFragment', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // SNAPSHOTS: readFragment / writeFragment
  // ────────────────────────────────────────────────────────────────────────────
  it('writes and reads a simple entity fragment (User); readFragment returns a plain snapshot (non-reactive)', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

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
    expect(isReactive(result)).toBe(false);

    // entity proxy stays reactive and reflects future writes (sanity)
    const live = graph.materializeEntity('User:1');
    expect(isReactive(live)).toBe(true);
    expect(live.name).toBe('Ada');

    writeFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `fragment UserNameOnly on User { name }`,
      data: { __typename: 'User', id: '1', name: 'Ada Lovelace' },
    });
    expect(live.name).toBe('Ada Lovelace');

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
    expect(isReactive(again)).toBe(false);
  });

  it('handles interface implementors (AudioPost/VideoPost) → canonical Post:1; readFragment is a snapshot', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

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

    const postProxy = graph.materializeEntity('Post:1');
    expect(isReactive(postProxy)).toBe(true);
    expect(postProxy.__typename).toBe('VideoPost');
    expect(postProxy.title).toBe('Video B');
    expect(postProxy.duration).toBe(120);

    const snap = readFragment({
      id: 'Post:1',
      fragment: /* GraphQL */ `
        fragment PostView on Post {
          id
          title
        }
      `,
    });
    expect(snap).toMatchObject({
      __typename: 'VideoPost',
      id: '1',
      title: 'Video B',
    });
    expect(isReactive(snap)).toBe(false);
  });

  it('writes & reads a nested field with args (connection page) via fragment; selection subtree is a snapshot (not reactive)', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, readFragment } = createFragments({
      dependencies: { graph, selections },
    });

    graph.putEntity({
      __typename: 'User',
      id: '1',
      name: 'John',
      profile: { __typename: 'Profile', id: 'p1', bio: 'dev' },
    });

    writeFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges {
              __typename
              cursor
              node { __typename id title }
            }
            pageInfo { __typename hasNextPage endCursor }
          }
        }
      `,
      data: {
        __typename: 'User',
        id: '1',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'Post', id: '101', title: 'Hello' } },
            { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'Post', id: '102', title: 'World' } },
          ],
          pageInfo: { __typename: 'PageInfo', hasNextPage: true, endCursor: 'c2' },
        },
      },
    });

    const out = readFragment({
      id: 'User:1',
      fragment: /* GraphQL */ `
        fragment UserPostsPage on User {
          posts(first: 2) {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename hasNextPage endCursor }
          }
        }
      `,
    });

    // Entire subtree is PLAIN
    expect(isReactive(out)).toBe(false);
    expect(isReactive(out.posts)).toBe(false);
    expect(isReactive(out.posts.edges)).toBe(false);
    expect(isReactive(out.posts.edges[0].node)).toBe(false);
    expect(isReactive(out.posts.pageInfo)).toBe(false);

    expect(out.posts.__typename).toBe('PostConnection');
    expect(out.posts.edges.map((e: any) => e.node.title)).toEqual(['Hello', 'World']);
    expect(out.posts.pageInfo).toEqual({
      __typename: 'PageInfo',
      hasNextPage: true,
      endCursor: 'c2',
    });

    // update entity and verify fresh snapshot reflects it
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
    expect(isReactive(out2.posts)).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // LIVE: watchFragment
  // ────────────────────────────────────────────────────────────────────────────
  it('watchFragment → live projection for entity-only fields; updates when entity changes', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, watchFragment } = createFragments({
      dependencies: { graph, selections },
    });

    writeFragment({
      id: 'User:10',
      fragment: /* GraphQL */ `fragment U on User { id name email }`,
      data: { __typename: 'User', id: '10', name: 'Eve', email: 'eve@example.com' },
    });

    const liveRef = watchFragment({
      id: 'User:10',
      fragment: /* GraphQL */ `fragment U on User { id name email }`,
    });

    // liveRef.value is a stable, reactive object
    expect(isReactive(liveRef.value)).toBe(true);
    expect(liveRef.value.__typename).toBe('User');
    expect(liveRef.value.name).toBe('Eve');

    // mutate via writeFragment → projection updates
    writeFragment({
      id: 'User:10',
      fragment: /* GraphQL */ `fragment NameOnly on User { name }`,
      data: { __typename: 'User', id: '10', name: 'Eve Updated' },
    });
    expect(liveRef.value.name).toBe('Eve Updated');
  });

  it('watchFragment with interface implementors: projection shows concrete __typename and updates', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, watchFragment } = createFragments({
      dependencies: { graph, selections },
    });

    writeFragment({
      id: 'Post:77',
      fragment: /* GraphQL */ `fragment A on AudioPost { id title }`,
      data: { __typename: 'AudioPost', id: '77', title: 'A-Title' },
    });

    const live = watchFragment({
      id: 'Post:77',
      fragment: /* GraphQL */ `fragment PV on Post { id title }`,
    });

    expect(isReactive(live.value)).toBe(true);
    expect(live.value.__typename).toBe('AudioPost');
    expect(live.value.title).toBe('A-Title');

    // change implementor
    writeFragment({
      id: 'Post:77',
      fragment: /* GraphQL */ `fragment V on VideoPost { id title duration }`,
      data: { __typename: 'VideoPost', id: '77', title: 'V-Title', duration: 42 },
    });

    expect(live.value.__typename).toBe('VideoPost');
    expect(live.value.title).toBe('V-Title');
  });

  it('watchFragment with connection args returns a live selection wrapper; entity/selection updates reflect in projection', () => {
    const graph = makeGraph();
    const selections = createSelections({ dependencies: { graph } });
    const { writeFragment, watchFragment } = createFragments({
      dependencies: { graph, selections },
    });

    // seed user and first page
    writeFragment({
      id: 'User:5',
      fragment: /* GraphQL */ `
        fragment Page on User {
          posts(first: 2) {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename endCursor hasNextPage }
          }
        }
      `,
      data: {
        __typename: 'User',
        id: '5',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'Post', id: 'p1', title: 'One' } },
            { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'Post', id: 'p2', title: 'Two' } },
          ],
          pageInfo: { __typename: 'PageInfo', endCursor: 'c2', hasNextPage: true },
        },
      },
    });

    const live = watchFragment({
      id: 'User:5',
      fragment: /* GraphQL */ `
        fragment Page on User {
          posts(first: 2) {
            __typename
            edges { cursor node { __typename id title } }
            pageInfo { __typename endCursor hasNextPage }
          }
        }
      `,
    });

    // selection wrapper is reactive
    expect(isReactive(live.value)).toBe(true);
    expect(isReactive(live.value.posts)).toBe(true);
    expect(Array.isArray(live.value.posts.edges)).toBe(true);
    expect(live.value.posts.edges.map((e: any) => e.node.title)).toEqual(['One', 'Two']);

    // entity mutation → reflected
    writeFragment({
      id: 'Post:p1', // still canonicalized as Post: p1 via keys
      fragment: /* GraphQL */ `fragment PT on Post { id title }`,
      data: { __typename: 'Post', id: 'p1', title: 'One (upd)' },
    });
    expect(live.value.posts.edges[0].node.title).toBe('One (upd)');

    // second page write for same args — replace or merge according to your write policy
    writeFragment({
      id: 'User:5',
      fragment: /* GraphQL */ `
        fragment Page on User {
          posts(first: 2) {
            __typename
            edges { __typename cursor node { __typename id title } }
            pageInfo { __typename endCursor hasNextPage }
          }
        }
      `,
      data: {
        __typename: 'User',
        id: '5',
        posts: {
          __typename: 'PostConnection',
          edges: [
            { __typename: 'PostEdge', cursor: 'c1x', node: { __typename: 'Post', id: 'p1', title: 'One (upd)' } },
            { __typename: 'PostEdge', cursor: 'c2x', node: { __typename: 'Post', id: 'p2', title: 'Two' } },
          ],
          pageInfo: { __typename: 'PageInfo', endCursor: 'c2x', hasNextPage: false },
        },
      },
    });

    expect(live.value.posts.pageInfo.endCursor).toBe('c2x');
    expect(live.value.posts.edges[0].cursor).toBe('c1x');
  });
});
