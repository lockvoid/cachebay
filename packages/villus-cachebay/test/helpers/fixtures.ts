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
   * Accepts titles as strings, or objects { title, id?, typename?, extras? }.
   * If id is provided, it is used for both node identity and the cursor (p{id}).
   */
  connection(
    titles: Array<
      | string
      | {
        title: string;
        id?: string | number;
        typename?: "Post" | "AudioPost" | "VideoPost";
        extras?: Record<string, any>;
      }
    >,
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

    const edges = titles.map((t, i) => {
      const isObj = typeof t === "object";
      const title = isObj ? (t as any).title : (t as string);
      const id =
        isObj && (t as any).id != null ? String((t as any).id) : String(fromId + i);
      const typename = isObj ? (t as any).typename ?? "Post" : "Post";
      const extras = isObj ? (t as any).extras ?? {} : {};

      return {
        __typename: "PostEdge",
        cursor: `p${id}`,
        node: post(id, title, typename, extras),
      };
    });

    const pageInfo = {
      __typename: "PageInfo" as const,
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
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
   * Accepts texts as strings, or objects { text, id?, extras? }.
   * If id is provided, it is used for both node identity and the cursor (c{id}).
   */
  connection(
    texts: Array<
      | string
      | {
        text: string;
        id?: string | number;
        extras?: Record<string, any>;
      }
    >,
    opts: {
      postId?: string;
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

    const edges = texts.map((t, i) => {
      const isObj = typeof t === "object";
      const text = isObj ? (t as any).text : (t as string);
      const id =
        isObj && (t as any).id != null ? String((t as any).id) : String(fromId + i);
      const extras = {
        ...(opts.postId ? { postId: opts.postId } : {}),
        ...(isObj ? (t as any).extras ?? {} : {}),
      };

      return {
        __typename: "CommentEdge",
        cursor: `c${id}`,
        node: comment(id, text, extras),
      };
    });

    const pageInfo = {
      __typename: "PageInfo" as const,
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
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
  query(
    texts: Parameters<typeof comments.connection>[0],
    opts?: Parameters<typeof comments.connection>[1]
  ) {
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
