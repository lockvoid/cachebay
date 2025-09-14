import { describe, it, expect } from 'vitest';
import { isReactive } from 'vue';
import { createGraph, type GraphAPI } from '@/src/core/graph';

// Keys: id for entity types; non-entities return null
const keyers = {
  User: (o: any) => o?.id ?? null,
  Profile: (o: any) => o?.id ?? null,
  Post: (o: any) => o?.id ?? null,
  AudioPost: (o: any) => o?.id ?? null,
  VideoPost: (o: any) => o?.id ?? null,
  Comment: (o: any) => o?.id ?? null,
  PageInfo: () => null,
  PostEdge: () => null,
};

function makeGraph(): GraphAPI {
  return createGraph({
    reactiveMode: 'shallow',
    keys: keyers,
    interfaces: { Post: ['AudioPost', 'VideoPost'] },
  });
}

describe('graph.ts — normalized store + materialization (generic, no connection special-cases)', () => {
  it('identify canonicalizes implementors AND handles base type directly', () => {
    const g = makeGraph();

    // 1) Base type straight
    const kb = g.putEntity({ __typename: 'Post', id: '1', title: 'Base' });
    expect(kb).toBe('Post:1');
    const base = g.materializeEntity('Post:1');
    expect(base.__typename).toBe('Post');
    expect(base.title).toBe('Base');

    // 2) Implementor → canonical key Post:1 (overwrites concrete)
    const k1 = g.putEntity({ __typename: 'AudioPost', id: '1', title: 'A' });
    expect(k1).toBe('Post:1');
    const p1 = g.materializeEntity('Post:1');
    expect(p1).toBe(base);
    expect(p1.__typename).toBe('AudioPost');
    expect(p1.title).toBe('A');

    // 3) Another implementor with same id → still Post:1, concrete becomes VideoPost
    const k2 = g.putEntity({ __typename: 'VideoPost', id: '1', title: 'V' });
    expect(k2).toBe('Post:1');
    const p2 = g.materializeEntity('Post:1');
    expect(p2).toBe(p1);
    expect(p2.__typename).toBe('VideoPost');
    expect(p2.title).toBe('V');
  });

  it('putEntity normalizes nested references; materializeEntity returns reactive proxies', () => {
    const g = makeGraph();

    // Seed: various entity typenames to prove generic behavior
    g.putEntity({
      __typename: 'Post', id: '101', title: 'Hello',
      author: { __typename: 'User', id: 'u1', name: 'Ada' },
      related: [
        { __typename: 'AudioPost', id: '201', title: 'Audio A' },
        { __typename: 'VideoPost', id: '202', title: 'Video B' }
      ],
      tags: ['intro', 'blue']
    });

    // normalized store holds refs
    const snapPost = g.getEntity('Post:101')!;
    expect(snapPost).toBeTruthy();
    expect(snapPost.author).toEqual({ __ref: 'User:u1' });
    expect(Array.isArray(snapPost.related)).toBe(true);
    expect(snapPost.related[0]).toEqual({ __ref: 'Post:201' }); // AudioPost canonicalized to Post
    expect(snapPost.related[1]).toEqual({ __ref: 'Post:202' }); // VideoPost canonicalized to Post

    // materialize entity
    const post = g.materializeEntity('Post:101');
    expect(isReactive(post)).toBe(true);
    expect(post.__typename).toBe('Post');
    expect(post.id).toBe('101');
    expect(isReactive(post.author)).toBe(true);
    expect(post.author.__typename).toBe('User');
    expect(post.author.id).toBe('u1');
    expect(Array.isArray(post.related)).toBe(true);
    // concrete implementors preserved on proxies
    const r0 = post.related[0];
    const r1 = post.related[1];
    expect(r0.__typename).toBe('AudioPost');
    expect(r1.__typename).toBe('VideoPost');

    // update entity → proxies reflect
    g.putEntity({ __typename: 'Post', id: '101', title: 'Hello World' });
    expect(post.title).toBe('Hello World');
  });

  describe('Selections (generic – arrays/objects only; entities by __ref)', () => {
    it('stores selection skeletons and materializes reactive trees; keeps pages distinct', () => {
      const g = makeGraph();

      // ---------- first page ----------
      const dataPage1 = {
        user: {
          __typename: 'User', id: '1', name: 'John Doe',
          profile: { __typename: 'Profile', id: 'profile-1', bio: 'dev', avatar: '/a.jpg' },
          posts: {
            __typename: 'PostConnection',
            edges: [
              { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'AudioPost', id: '101', title: 'Audio One' } },
              { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'VideoPost', id: '102', title: 'Video Two' } },
              { __typename: 'PostEdge', cursor: 'c3', node: { __typename: 'Post', id: '103', title: 'Plain Three' } },
            ],
            pageInfo: { __typename: 'PageInfo', hasNextPage: true, endCursor: 'c3' }
          }
        }
      };

      const qUser = 'user({"id":"1"})';
      const qPosts = 'User:1.posts({"first":10})';
      g.putSelection(qUser, dataPage1.user);
      g.putSelection(qPosts, dataPage1.user.posts);

      // entities created (implementors canonicalized)
      expect(g.getEntity('User:1')).toBeTruthy();
      expect(g.getEntity('Profile:profile-1')).toBeTruthy();
      expect(g.getEntity('Post:101')).toBeTruthy();
      expect(g.getEntity('Post:102')).toBeTruthy();
      expect(g.getEntity('Post:103')).toBeTruthy();

      // skeletons have __ref
      const rootSkel = g.getSelection(qUser)!;
      expect(rootSkel).toEqual({ __ref: 'User:1' });

      const postsSkel = g.getSelection(qPosts)!;
      expect(postsSkel.edges[0].node).toEqual({ __ref: 'Post:101' });
      expect(postsSkel.edges[1].node).toEqual({ __ref: 'Post:102' });
      expect(postsSkel.edges[2].node).toEqual({ __ref: 'Post:103' });

      // materialize root (User) & connection page 1
      const mUser = g.materializeSelection(qUser);
      const mPosts = g.materializeSelection(qPosts);

      expect(mUser.__typename).toBe('User');
      expect(mUser.id).toBe('1');
      expect(isReactive(mUser.profile)).toBe(true);

      expect(Array.isArray(mPosts.edges)).toBe(true);
      const ids = mPosts.edges.map((e: any) => e.node.id);
      expect(ids).toEqual(['101', '102', '103']);
      // concrete implementors visible on proxies
      expect(mPosts.edges[0].node.__typename).toBe('AudioPost');
      expect(mPosts.edges[1].node.__typename).toBe('VideoPost');
      expect(mPosts.edges[2].node.__typename).toBe('Post');

      // second page (distinct selection)
      const dataPage2 = {
        user: {
          __typename: 'User', id: '1',
          posts: {
            __typename: 'PostConnection',
            edges: [
              { __typename: 'PostEdge', cursor: 'c4', node: { __typename: 'AudioPost', id: '104', title: 'Audio Four' } },
              { __typename: 'PostEdge', cursor: 'c5', node: { __typename: 'VideoPost', id: '105', title: 'Video Five' } },
            ],
            pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: 'c5' }
          }
        }
      };
      const qPosts2 = 'User:1.posts({"first":10,"after":"c3"})';
      g.putSelection(qPosts2, dataPage2.user.posts);

      expect(g.getSelection(qPosts)).toBeTruthy();
      expect(g.getSelection(qPosts2)).toBeTruthy();

      const mPosts2 = g.materializeSelection(qPosts2);
      expect(mPosts2.edges.map((e: any) => e.node.id)).toEqual(['104', '105']);
      expect(mPosts2.edges[0].node.__typename).toBe('AudioPost');
      expect(mPosts2.edges[1].node.__typename).toBe('VideoPost');

      // reactive update: change Post:101 title
      g.putEntity({ __typename: 'AudioPost', id: '101', title: 'Audio One (Upd)' });
      expect(mPosts.edges[0].node.title).toBe('Audio One (Upd)');
    });
  });

  it('materializeSelection reuses the same entity proxies across different trees', () => {
    const g = makeGraph();

    // Seed entities
    g.putEntity({ __typename: 'User', id: '1', name: 'John' });
    g.putEntity({ __typename: 'Post', id: 'p1', title: 'Hello', author: { __typename: 'User', id: '1', name: 'John' } });

    // Two selections referencing the same entity
    const qA = 'post({"id":"p1"})';
    const qB = 'featuredPost({})';
    g.putSelection(qA, { __typename: 'Post', id: 'p1' });
    g.putSelection(qB, { __typename: 'Post', id: 'p1' });

    const a = g.materializeSelection(qA);
    const b = g.materializeSelection(qB);
    expect(a).toBe(b); // same underlying entity proxy for Post:p1
  });

  it('keeps scalar tags embedded and reactive (no entities created)', () => {
    const g = makeGraph();

    g.putEntity({
      __typename: 'Post', id: '101', title: 'Hello',
      tags: ['intro', 'blue']    // scalar array
    });

    // Store snapshot has inline scalars
    const snap = g.getEntity('Post:101')!;
    expect(snap.tags).toEqual(['intro', 'blue']);

    // No Tag:* entities were created
    expect(g.getEntity('Tag:t1')).toBeUndefined();

    // Materialized proxy has a shallow-reactive array of scalars
    const post = g.materializeEntity('Post:101');
    expect(Array.isArray(post.tags)).toBe(true);
    expect(post.tags).toEqual(['intro', 'blue']);

    // Updating the entity adds a new scalar; proxy reflects it
    g.putEntity({ __typename: 'Post', id: '101', tags: ['intro', 'blue', 'fresh'] });
    expect(post.tags).toEqual(['intro', 'blue', 'fresh']);
  });

  it('embeds object tags without identity; normalizes Tag entities with identity', () => {
    const g = makeGraph();

    // 1) Non-entity tag objects stay embedded
    g.putEntity({
      __typename: 'Post', id: '201', title: 'Embed objects',
      tags: [{ label: 'intro', color: 'blue' }, { label: 'tips', color: 'green' }]
    });
    const snap1 = g.getEntity('Post:201')!;
    expect(snap1.tags[0]).toEqual({ label: 'intro', color: 'blue' }); // inline
    expect(g.getEntity('Tag:t1')).toBeUndefined();

    const post201 = g.materializeEntity('Post:201');
    expect(post201.tags[0].label).toBe('intro'); // shallow-reactive object

    // 2) True Tag entities (typename+id) are normalized
    g.putEntity({
      __typename: 'Post', id: '202', title: 'Entity tags',
      tags: [
        { __typename: 'Tag', id: 't1', label: 'intro' },
        { __typename: 'Tag', id: 't2', label: 'graphql' },
      ]
    });

    // Post snapshot contains refs
    const snap2 = g.getEntity('Post:202')!;
    expect(snap2.tags).toEqual([{ __ref: 'Tag:t1' }, { __ref: 'Tag:t2' }]);

    // Tag entities exist
    expect(g.getEntity('Tag:t1')).toEqual({ label: 'intro' });
    expect(g.getEntity('Tag:t2')).toEqual({ label: 'graphql' });

    // Materialized post has Tag proxies
    const post202 = g.materializeEntity('Post:202');
    expect(post202.tags[0].__typename).toBe('Tag');
    expect(post202.tags[0].id).toBe('t1');
    expect(post202.tags[0].label).toBe('intro');

    // Update Tag entity and verify all materialized views see it
    g.putEntity({ __typename: 'Tag', id: 't1', label: 'introduction' });
    expect(post202.tags[0].label).toBe('introduction');
  });
});
