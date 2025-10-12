export interface UserNode {
  id: string;
  email: string;
  typename?: "User" | "AdminUser";
  [key: string]: any;
}

export interface PostNode {
  id: string;
  title: string;
  flags?: string[];
  typename?: "Post" | "AudioPost" | "VideoPost";
  [key: string]: any;
}

export interface CommentNode {
  uuid: string;
  text: string;
  typename?: "Comment";
  [key: string]: any;
}

export interface TagNode {
  id: string;
  name: string;
  typename?: "Tag";
  [key: string]: any;
}

export interface MediaNode {
  key: string;
  mediaUrl: string;
  typename?: "Media";
  [key: string]: any;
}

export const user = ({ id, email, typename = "User", ...extras }: UserNode) => ({
  __typename: typename,
  id,
  email,
  ...extras,
});

export const post = ({ id, title, flags = [], typename = "Post", ...extras }: PostNode) => ({
  __typename: typename,
  id,
  title,
  flags,
  ...extras,
});

export const comment = ({ uuid, text, typename = "Comment", ...extras }: CommentNode) => ({
  __typename: typename,
  uuid,
  text,
  ...extras,
});

export const tag = ({ id, name, typename = "Tag", ...extras }: TagNode) => ({
  __typename: typename,
  id,
  name,
  ...extras,
});

export const media = ({ key, mediaUrl, typename = "Media", ...extras }: MediaNode) => ({
  __typename: typename,
  key,
  mediaUrl,
  ...extras,
});

export const users = {
  buildNode(userData: Partial<UserNode>) {
    const { email, id, ...extras } = userData;

    return user({ ...extras, id, email });
  },

  buildConnection(items: Array<Partial<UserNode>>, customPageInfo = {}) {
    const edges = items.map((itemData) => {
      const node = users.buildNode(itemData);

      return {
        __typename: "UserEdge",
        cursor: node.id,
        node,
      };
    });

    const pageInfo = {
      __typename: "PageInfo",
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: false,
      hasPreviousPage: false,

      ...customPageInfo,
    };

    return {
      __typename: "UserConnection",
      edges,
      pageInfo,
    };
  },
};

export const posts = {
  buildNode(postData: Partial<PostNode>) {
    const { title, id, ...extras } = postData;

    return post({ id, title, ...extras });
  },

  buildConnection(items: Array<Partial<PostNode>>, customPageInfo = {}) {
    const edges = items.map((itemData) => {
      const node = posts.buildNode(itemData);

      return {
        __typename: "PostEdge",
        cursor: node.id,
        node,
      };
    });

    const pageInfo = {
      __typename: "PageInfo",
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: false,
      hasPreviousPage: false,

      ...customPageInfo,
    };

    return {
      __typename: "PostConnection",
      edges,
      pageInfo,
    };
  },
};

export const comments = {
  buildNode(commentData: Partial<CommentNode>) {
    const { text, uuid, ...extras } = commentData;

    return comment({ ...extras, uuid, text });
  },

  buildConnection(items: Array<Partial<CommentNode>>, customPageInfo = {}) {
    const edges = items.map((itemData) => {
      const node = comments.buildNode(itemData);

      return {
        __typename: "CommentEdge",
        cursor: node.uuid,
        node,
      };
    });

    const pageInfo = {
      __typename: "PageInfo",
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: false,
      hasPreviousPage: false,

      ...customPageInfo,
    };

    return {
      __typename: "CommentConnection",
      edges,
      pageInfo,
    };
  },
};

export const tags = {
  buildNode(tagData: Partial<TagNode>) {
    const { name, id, ...extras } = tagData;

    return tag({ ...extras, id, name });
  },

  buildConnection(items: Array<Partial<TagNode>>, customPageInfo = {}) {
    const edges = items.map((itemData) => {
      const node = tags.buildNode(itemData);

      return {
        __typename: "TagEdge",
        cursor: node.id,
        node,
      };
    });

    const pageInfo = {
      __typename: "PageInfo",
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: false,
      hasPreviousPage: false,

      ...customPageInfo,
    };

    return {
      __typename: "TagConnection",
      edges,
      pageInfo,
    };
  },
};

export const medias = {
  buildNode(mediaData: Partial<MediaNode>) {
    const { name, id, ...extras } = mediaData;

    return media({ ...extras, id, name });
  },

  buildConnection(items: Array<Partial<MediaNode>>, customPageInfo = {}) {
    const edges = items.map((itemData) => {
      const node = medias.buildNode(itemData);

      return {
        __typename: "MediaEdge",
        cursor: node.id,
        node,
      };
    });

    const pageInfo = {
      __typename: "PageInfo",
      startCursor: edges.length ? edges[0].cursor : null,
      endCursor: edges.length ? edges[edges.length - 1].cursor : null,
      hasNextPage: false,
      hasPreviousPage: false,

      ...customPageInfo,
    };

    return {
      __typename: "MediaConnection",
      edges,
      pageInfo,
    };
  },
};
