
export interface UserNode {
  id: string;
  email: string;
  typename?: "User" | "AdminUser";
  [key: string]: any;
}

export interface PostNode {
  id: string;
  title: string;
  tags?: string[];
  typename?: "Post" | "AudioPost" | "VideoPost";
  [key: string]: any;
}

export interface CommentNode {
  uuid: string;
  text: string;
  typename?: "Comment";
  [key: string]: any;
}

export const user = ({ id, email, typename = "User", ...extras }: UserNode) => ({
  __typename: typename,
  id,
  email,
  ...extras,
});

export const post = ({ id, title, tags = [], typename = "Post", ...extras }: PostNode) => ({
  __typename: typename,
  id,
  title,
  tags,
  ...extras,
});

export const comment = ({ uuid, text, typename = "Comment", ...extras }: CommentNode) => ({
  __typename: typename,
  // id: uuid,
  uuid,
  text,
  ...extras,
});

export const users = {
  buildNode(userData: Partial<UserNode>, index = 0) {
    const { email, id = `u${index + 1}`, typename, ...extras } = userData;

    return user({ id, email, typename, ...extras });
  },

  buildConnection(items: Array<Partial<UserNode>>) {
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

  buildConnection(items: Array<Partial<PostNode>>) {
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

  buildConnection(items: Array<Partial<CommentNode>>) {
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
    };

    return {
      __typename: "CommentConnection",
      edges,
      pageInfo,
    };
  },
};
