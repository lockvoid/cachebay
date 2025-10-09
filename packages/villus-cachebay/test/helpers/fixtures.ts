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
  buildNode(userData: Partial<UserNode>, index = 0) {
    const { email, id = `u${index + 1}`, typename, ...extras } = userData;

    return user({ id, email, typename, ...extras });
  },

  buildConnection(items: Array<Partial<UserNode>>, customPageInfo = {}) {
    const edges = items.map((itemData, i) => {
      const node = users.buildNode(itemData, i);

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
  buildNode(postData: Partial<PostNode>, index = 0) {
    const { title, id = `p${index + 1}`, typename, ...extras } = postData;

    return post({ id, title, typename, ...extras });
  },

  buildConnection(items: Array<Partial<PostNode>>, customPageInfo = {}) {
    const edges = items.map((itemData, i) => {
      const node = posts.buildNode(itemData, i);

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
  buildNode(commentData: Partial<CommentNode>, index = 0) {
    const { text, uuid = `c${index + 1}`, ...extras } = commentData;

    return comment({ uuid, text, ...extras });
  },

  buildConnection(items: Array<Partial<CommentNode>>, customPageInfo = {}) {
    const edges = items.map((itemData, i) => {
      const node = comments.buildNode(itemData, i);

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
  buildNode(tagData: Partial<TagNode>, index = 0) {
    const { name, id = `t${index + 1}`, typename, ...extras } = tagData;

    return tag({ id, name: name ?? `Tag ${index + 1}`, typename, ...extras });
  },

  buildConnection(items: Array<Partial<TagNode>>, customPageInfo = {}) {
    const edges = items.map((itemData, i) => {
      const node = tags.buildNode(itemData, i);

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
  buildNode(mediaData: Partial<MediaNode>, index = 0) {
    const { name, id = `m${index + 1}`, typename, ...extras } = mediaData;

    return media({ id, name: name ?? `Media ${index + 1}`, typename, ...extras });
  },

  buildConnection(items: Array<Partial<MediaNode>>, customPageInfo = {}) {
    const edges = items.map((itemData, i) => {
      const node = medias.buildNode(itemData, i);

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
