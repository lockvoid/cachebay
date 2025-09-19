// test/helpers/fixtures.ts
/* Clean, composable fixtures for integration tests.
   Everything here returns plain GraphQL-shaped objects.
   - "entity builders": user(), post(), comment()
   - "connection builders": users.connection(), posts.connection(), comments.connection()
   - "query wrappers": users.query(), comments.query(), post.query(), user.query()
*/

export const user = (id: string, email: string) => ({
  __typename: "User",
  id,
  email,
});

export const post = (
  id: string,
  title: string,
  typename: "Post" | "AudioPost" | "VideoPost" = "Post",
  extras: Record<string, any> = {}
) => ({
  __typename: typename,
  id,
  title,
  tags: [],
  ...extras,
});

/** We identify Comment by uuid (but keep id too for readability) */
export const comment = (uuid: string, text: string, extras: Record<string, any> = {}) => ({
  __typename: "Comment",
  uuid,
  id: uuid, // harmless duplicate, identity uses uuid
  text,
  ...extras,
});

export const users = {
  /** Build a UserConnection (no Query wrapper) */
  connection(
    emails: string[],
    opts: {
      fromId?: number;
      pageInfo?: Partial<{
        __typename: "PageInfo";
        startCursor: string | null;
        endCursor: string | null;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
      }>;
    } = {}
  ) {
    const fromId = opts.fromId ?? 1;
    const edges = emails.map((email, i) => ({
      __typename: "UserEdge",
      cursor: `c${fromId + i}`,
      node: user(String(fromId + i), email),
    }));

    const pageInfo = {
      __typename: "PageInfo" as const,
      startCursor: emails.length ? `c${fromId}` : null,
      endCursor: emails.length ? `c${fromId + emails.length - 1}` : null,
      hasNextPage: false,
      hasPreviousPage: false,
      ...opts.pageInfo,
    };

    return {
      __typename: "UserConnection",
      edges,
      pageInfo,
    };
  },

  /** Wrap in Query { users { ... } } and wrap again with { data } for fetch mock/seedCache */
  query(emails: string[], opts?: Parameters<typeof users.connection>[1]) {
    return {
      data: {
        __typename: "Query",
        users: users.connection(emails, opts),
      },
    };
  },
};

export const posts = {
  /**
   * Build a PostConnection (no Query wrapper).
   * You may inject per-node extras (e.g. { comments: comments.connection([...]) }).
   */
  connection(
    titles: Array<string | { title: string; typename?: "Post" | "AudioPost" | "VideoPost"; extras?: Record<string, any> }>,
    opts: { fromId?: number; pageInfo?: Partial<{ __typename: "PageInfo"; startCursor: string | null; endCursor: string | null; hasNextPage: boolean; hasPreviousPage: boolean; }> } = {}
  ) {
    const fromId = opts.fromId ?? 1;

    const edges = titles.map((t, i) => {
      const isObj = typeof t === "object";
      const title = isObj ? (t as any).title : (t as string);
      const typename = isObj ? (t as any).typename ?? "Post" : "Post";
      const extras = isObj ? (t as any).extras ?? {} : {};

      return {
        __typename: "PostEdge",
        cursor: `p${fromId + i}`,
        node: post(String(fromId + i), title, typename, extras),
      };
    });

    const pageInfo = {
      __typename: "PageInfo" as const,
      startCursor: titles.length ? `p${fromId}` : null,
      endCursor: titles.length ? `p${fromId + titles.length - 1}` : null,
      hasNextPage: false,
      hasPreviousPage: false,
      ...opts.pageInfo,
    };

    return {
      __typename: "PostConnection",
      edges,
      pageInfo,
    };
  },

  /** Optional helper: wrap in { data: { post: ... } } for single post query */
  singleQuery(title: string, id = "1", typename: "Post" | "AudioPost" | "VideoPost" = "Post") {
    return {
      data: {
        __typename: "Query",
        post: post(id, title, typename),
      },
    };
  },
};

export const comments = {
  /**
   * Build a CommentConnection (no Query wrapper).
   * We use uuid as identity; we also copy postId into nodes if provided.
   */
  connection(
    texts: string[],
    opts: {
      postId?: string;
      fromId?: number;
      pageInfo?: Partial<{ __typename: "PageInfo"; startCursor: string | null; endCursor: string | null; hasNextPage: boolean; hasPreviousPage: boolean; }>;
    } = {}
  ) {
    const fromId = opts.fromId ?? 1;

    const edges = texts.map((text, i) => ({
      __typename: "CommentEdge",
      cursor: `c${fromId + i}`,
      node: comment(String(fromId + i), text, opts.postId ? { postId: opts.postId } : {}),
    }));

    const pageInfo = {
      __typename: "PageInfo" as const,
      startCursor: texts.length ? `c${fromId}` : null,
      endCursor: texts.length ? `c${fromId + texts.length - 1}` : null,
      hasNextPage: false,
      hasPreviousPage: false,
      ...opts.pageInfo,
    };

    return {
      __typename: "CommentConnection",
      edges,
      pageInfo,
    };
  },

  /** Wrap for { data: { comments: ... } } */
  query(texts: string[], opts?: Parameters<typeof comments.connection>[1]) {
    return {
      data: {
        __typename: "Query",
        comments: comments.connection(texts, opts),
      },
    };
  },
};

export const singleUser = {
  query(id: string, email: string) {
    return {
      data: {
        __typename: "Query",
        user: user(id, email),
      },
    };
  },
};
