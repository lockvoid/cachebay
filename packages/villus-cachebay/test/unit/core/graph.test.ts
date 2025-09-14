// test/unit/core/graph.test.ts
import { describe, it, expect } from 'vitest';
import { isReactive } from 'vue';
import { createGraph, type GraphAPI } from '@/src/core/graph';

// Minimal keyers: implementors are canonicalized by interfaces.
// Non-entities like PageInfo/PostEdge/etc. don't need keyers.
const keyers = {
  User: (o: any) => o?.id ?? null,
  Profile: (o: any) => o?.id ?? null,
  Post: (o: any) => o?.id ?? null,
  Comment: (o: any) => o?.id ?? null,
  Tag: (o: any) => o?.id ?? null,
};

function makeGraph(overrides?: Partial<Parameters<typeof createGraph>[0]>): GraphAPI {
  return createGraph({
    reactiveMode: 'shallow',
    keys: keyers,
    interfaces: { Post: ['AudioPost', 'VideoPost'] },
    ...overrides,
  });
}

describe('graph.ts — normalized store + materialization (entities + selections; generic, no connection-special casing)', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // IDENTITY / IDENTIFY
  // ────────────────────────────────────────────────────────────────────────────
  describe('identify', () => {
    it('returns canonical keys for base type and interface implementors', () => {
      const g = makeGraph();

      // Base type straight
      const kb = g.identify({ __typename: 'Post', id: '1' });
      expect(kb).toBe('Post:1');

      // Implementor → canonical key "Post:1"
      const ka = g.identify({ __typename: 'AudioPost', id: '1' });
      const kv = g.identify({ __typename: 'VideoPost', id: '1' });
      expect(ka).toBe('Post:1');
      expect(kv).toBe('Post:1');
    });

    it('supports custom keyers (e.g., uuid) and ignores non-entities', () => {
      const g = makeGraph({
        keys: {
          ...keyers,
          Profile: (o: any) => o?.uuid ?? null,
        },
      });

      expect(g.identify({ __typename: 'Profile', uuid: 'profile-uuid-1' })).toBe('Profile:profile-uuid-1');
      // non-entity → null
      expect(g.identify({ __typename: 'PageInfo', endCursor: 'c2' })).toBe(null);
      expect(g.identify({ foo: 1 })).toBe(null);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // ENTITIES: put/get/materialize/remove
  // ────────────────────────────────────────────────────────────────────────────
  describe('entities API', () => {
    it('canonicalizes implementors, merges subsequent writes, and preserves last concrete __typename on the proxy', () => {
      const g = makeGraph();

      // 1) Base Post write
      const k0 = g.putEntity({ __typename: 'Post', id: '1', title: 'Base' });
      expect(k0).toBe('Post:1');
      const p0 = g.materializeEntity('Post:1');
      expect(isReactive(p0)).toBe(true);
      expect(p0.__typename).toBe('Post');
      expect(p0.id).toBe('1');
      expect(p0.title).toBe('Base');

      // 2) Implementor → same canonical key, new concrete type on proxy
      const k1 = g.putEntity({ __typename: 'AudioPost', id: '1', title: 'A' });
      expect(k1).toBe('Post:1');
      const p1 = g.materializeEntity('Post:1');
      expect(p1).toBe(p0);
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

    it('normalizes nested references; materializeEntity returns reactive proxies and reflects updates', () => {
      const g = makeGraph();

      g.putEntity({
        __typename: 'Post',
        id: '101',
        title: 'Hello',
        author: { __typename: 'User', id: 'u1', name: 'Ada' },
        related: [
          { __typename: 'AudioPost', id: '201', title: 'Audio A' },
          { __typename: 'VideoPost', id: '202', title: 'Video B' },
        ],
        tags: ['intro', 'blue'], // scalar array stays embedded
      });

      // normalized store holds refs (and identity)
      const snapPost = g.getEntity('Post:101')!;
      expect(snapPost).toBeTruthy();
      expect(snapPost.__typename).toBe('Post');
      expect(snapPost.id).toBe('101');
      expect(snapPost.author).toEqual({ __ref: 'User:u1' });
      expect(Array.isArray(snapPost.related)).toBe(true);
      // implementors canonicalized to Post:*
      expect(snapPost.related[0]).toEqual({ __ref: 'Post:201' });
      expect(snapPost.related[1]).toEqual({ __ref: 'Post:202' });

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

    it('removeEntity clears fields from any live proxy (current impl clears all; no identity kept)', () => {
      const g = makeGraph();

      g.putEntity({ __typename: 'User', id: '1', name: 'John', email: 'john@example.com' });
      const u = g.materializeEntity('User:1');
      expect(u.name).toBe('John');
      expect(u.email).toBe('john@example.com');

      // Remove entity snapshot
      expect(g.removeEntity('User:1')).toBe(true);

      // Proxy now empty (impl choice: cleared fully)
      expect(Object.keys(u)).toEqual([]);

      // Subsequent remove returns false
      expect(g.removeEntity('User:1')).toBe(false);
    });

    describe('tags normalization variations', () => {
      it('keeps scalar tags embedded and reactive (no Tag entities created)', () => {
        const g = makeGraph();

        g.putEntity({
          __typename: 'Post',
          id: '101',
          title: 'Hello',
          tags: ['intro', 'blue'],
        });

        // Snapshot has identity + inline scalars
        const snap = g.getEntity('Post:101')!;
        expect(snap.tags).toEqual(['intro', 'blue']);

        // Materialized proxy sees scalars
        const post = g.materializeEntity('Post:101');
        expect(Array.isArray(post.tags)).toBe(true);
        expect(post.tags).toEqual(['intro', 'blue']);

        // Update → proxy reflects
        g.putEntity({ __typename: 'Post', id: '101', tags: ['intro', 'blue', 'fresh'] });
        expect(post.tags).toEqual(['intro', 'blue', 'fresh']);
      });

      it('embeds object tags without identity; normalizes Tag entities when identity present', () => {
        const g = makeGraph();

        // 1) Non-entity tag objects stay embedded
        g.putEntity({
          __typename: 'Post',
          id: '201',
          title: 'Embed objects',
          tags: [{ label: 'intro', color: 'blue' }, { label: 'tips', color: 'green' }],
        });
        const snap1 = g.getEntity('Post:201')!;
        expect(snap1.tags[0]).toEqual({ label: 'intro', color: 'blue' }); // inline

        const post201 = g.materializeEntity('Post:201');
        expect(post201.tags[0].label).toBe('intro'); // shallow-reactive object

        // 2) True Tag entities (typename+id) are normalized
        g.putEntity({
          __typename: 'Post',
          id: '202',
          title: 'Entity tags',
          tags: [
            { __typename: 'Tag', id: 't1', label: 'intro' },
            { __typename: 'Tag', id: 't2', label: 'graphql' },
          ],
        });

        // Post snapshot contains refs
        const snap2 = g.getEntity('Post:202')!;
        expect(snap2.tags).toEqual([{ __ref: 'Tag:t1' }, { __ref: 'Tag:t2' }]);

        // Tag entities exist
        expect(g.getEntity('Tag:t1')).toEqual({ __typename: 'Tag', id: 't1', label: 'intro' });
        expect(g.getEntity('Tag:t2')).toEqual({ __typename: 'Tag', id: 't2', label: 'graphql' });

        // Materialized post has Tag proxies
        const post202 = g.materializeEntity('Post:202');
        expect(post202.tags[0].__typename).toBe('Tag');
        expect(post202.tags[0].id).toBe('t1');
        expect(post202.tags[0].label).toBe('intro');

        // Update Tag entity and verify reactive reflection
        g.putEntity({ __typename: 'Tag', id: 't1', label: 'introduction' });
        expect(post202.tags[0].label).toBe('introduction');
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SELECTIONS: put/get/materialize/remove (generic skeletons)
  // ────────────────────────────────────────────────────────────────────────────
  describe('selections API', () => {
    it('stores selection skeletons and materializes reactive trees; keeps pages distinct', () => {
      const g = makeGraph();

      // ---------- first page ----------
      const dataPage1 = {
        user: {
          __typename: 'User',
          id: '1',
          name: 'John Doe',
          profile: { __typename: 'Profile', id: 'profile-1', bio: 'dev', avatar: '/a.jpg' },
          posts: {
            __typename: 'PostConnection',
            edges: [
              { __typename: 'PostEdge', cursor: 'c1', node: { __typename: 'AudioPost', id: '101', title: 'Audio One' } },
              { __typename: 'PostEdge', cursor: 'c2', node: { __typename: 'VideoPost', id: '102', title: 'Video Two' } },
              { __typename: 'PostEdge', cursor: 'c3', node: { __typename: 'Post', id: '103', title: 'Plain Three' } },
            ],
            pageInfo: { __typename: 'PageInfo', hasNextPage: true, endCursor: 'c3' },
          },
        },
      };

      const qUser = 'user({"id":"1"})';
      const qPosts1 = 'User:1.posts({"first":10})';

      g.putSelection(qUser, dataPage1.user);
      g.putSelection(qPosts1, dataPage1.user.posts);

      // Entities created (implementors canonicalized to Post:* keys)
      expect(g.getEntity('User:1')).toBeTruthy();
      expect(g.getEntity('Profile:profile-1')).toBeTruthy();
      expect(g.getEntity('Post:101')).toBeTruthy();
      expect(g.getEntity('Post:102')).toBeTruthy();
      expect(g.getEntity('Post:103')).toBeTruthy();

      // Skeletons have __ref
      const rootSkel = g.getSelection(qUser)!;
      expect(rootSkel).toEqual({ __ref: 'User:1' });

      const postsSkel1 = g.getSelection(qPosts1)!;
      expect(postsSkel1.edges[0].node).toEqual({ __ref: 'Post:101' });
      expect(postsSkel1.edges[1].node).toEqual({ __ref: 'Post:102' });
      expect(postsSkel1.edges[2].node).toEqual({ __ref: 'Post:103' });

      // Materialize root & page1 selection
      const mUser = g.materializeSelection(qUser);
      const mPosts1 = g.materializeSelection(qPosts1);

      expect(mUser.__typename).toBe('User');
      expect(mUser.id).toBe('1');
      expect(isReactive(mUser.profile)).toBe(true);

      expect(Array.isArray(mPosts1.edges)).toBe(true);
      const ids1 = mPosts1.edges.map((e: any) => e.node.id);
      expect(ids1).toEqual(['101', '102', '103']);
      // Concrete implementors visible on proxies
      expect(mPosts1.edges[0].node.__typename).toBe('AudioPost');
      expect(mPosts1.edges[1].node.__typename).toBe('VideoPost');
      expect(mPosts1.edges[2].node.__typename).toBe('Post');

      // Reactive entity update reflects in this selection
      g.putEntity({ __typename: 'AudioPost', id: '101', title: 'Audio One (Upd)' });
      expect(mPosts1.edges[0].node.title).toBe('Audio One (Upd)');

      // ---------- second page ----------
      const dataPage2 = {
        user: {
          __typename: 'User',
          id: '1',
          posts: {
            __typename: 'PostConnection',
            edges: [
              { __typename: 'PostEdge', cursor: 'c4', node: { __typename: 'AudioPost', id: '104', title: 'Audio Four' } },
              { __typename: 'PostEdge', cursor: 'c5', node: { __typename: 'VideoPost', id: '105', title: 'Video Five' } },
            ],
            pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: 'c5' },
          },
        },
      };
      const qPosts2 = 'User:1.posts({"first":10,"after":"c3"})';

      g.putSelection(qPosts2, dataPage2.user.posts);

      expect(g.getSelection(qPosts1)).toBeTruthy();
      expect(g.getSelection(qPosts2)).toBeTruthy();

      const mPosts2 = g.materializeSelection(qPosts2);
      expect(mPosts2.edges.map((e: any) => e.node.id)).toEqual(['104', '105']);
      expect(mPosts2.edges[0].node.__typename).toBe('AudioPost');
      expect(mPosts2.edges[1].node.__typename).toBe('VideoPost');
    });

    it('selection wrappers are distinct objects across trees but track the same entity reactively', () => {
      const g = makeGraph();

      // Seed entities
      g.putEntity({ __typename: 'User', id: '1', name: 'John' });
      g.putEntity({
        __typename: 'Post',
        id: 'p1',
        title: 'Hello',
        author: { __typename: 'User', id: '1', name: 'John' },
      });

      // Two selections referencing the same entity
      const qA = 'post({"id":"p1"})';
      const qB = 'featuredPost({})';
      g.putSelection(qA, { __typename: 'Post', id: 'p1' });
      g.putSelection(qB, { __typename: 'Post', id: 'p1' });

      const a = g.materializeSelection(qA);
      const b = g.materializeSelection(qB);

      // Wrappers are not the same object (by design)
      expect(a).not.toBe(b);

      // They point to the same entity data
      expect(a.__typename).toBe('Post');
      expect(b.__typename).toBe('Post');
      expect(a.id).toBe('p1');
      expect(b.id).toBe('p1');
      expect(a.title).toBe('Hello');
      expect(b.title).toBe('Hello');

      // Update the entity → both wrappers reflect the change
      g.putEntity({ __typename: 'Post', id: 'p1', title: 'Hello (Updated)' });
      expect(a.title).toBe('Hello (Updated)');
      expect(b.title).toBe('Hello (Updated)');
    });

    it('removeSelection clears a materialized selection (reactive) but leaves entities intact (current impl clears fully)', () => {
      const g = makeGraph();

      // Seed some entities & selection
      g.putEntity({ __typename: 'User', id: '1', name: 'John' });
      const q = 'user({"id":"1"})';
      g.putSelection(q, { __typename: 'User', id: '1' });

      const sel = g.materializeSelection(q);
      expect(sel.__typename).toBe('User');
      expect(sel.id).toBe('1');
      expect(sel.name).toBe('John');

      // Remove selection skeleton (not entities!)
      expect(g.removeSelection(q)).toBe(true);

      // Selection proxy is cleared completely (impl choice)
      expect(Object.keys(sel)).toEqual([]);

      // Entity remains intact in the store and can be materialized independently
      const snap = g.getEntity('User:1')!;
      expect(snap).toEqual({ __typename: 'User', id: '1', name: 'John' });
      const entityProxy = g.materializeEntity('User:1');
      expect(entityProxy.name).toBe('John');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // INSPECT (debug helper)
  // ────────────────────────────────────────────────────────────────────────────
  describe('inspect', () => {
    it('exposes entities, selections and the config (keys and interfaces) for debugging', () => {
      const g = makeGraph();

      // Write a tiny graph
      g.putEntity({ __typename: 'User', id: '1', name: 'Ada' });
      g.putSelection('user({"id":"1"})', { __typename: 'User', id: '1' });

      const snapshot = g.inspect();

      // Entities snapshots include identity fields
      expect(snapshot.entities['User:1']).toEqual({ __typename: 'User', id: '1', name: 'Ada' });
      expect(snapshot.selections['user({"id":"1"})']).toEqual({ __ref: 'User:1' });

      expect(snapshot.config.keys.length).toBeGreaterThan(0);
      expect(snapshot.config.interfaces).toMatchObject({ Post: ['AudioPost', 'VideoPost'] });
    });
  });
});
