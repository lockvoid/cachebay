export const likeCount = (i, j) => {
  return ((i * 131 + j * 977) % 100) | 0;
};

export const buildUsersResponse = ({ users = 1000, posts = 5, comments = 3 }) => {
  return {
    __typename: "Query",
    users: {
      __typename: "UserConnection",
      edges: Array.from({ length: users }, (_, i) => ({
        __typename: "UserEdge",
        cursor: "u" + (i + 1),
        node: {
          __typename: "User",
          id: "u" + (i + 1),
          name: "User " + (i + 1),
          avatar: `https://i.example.com/150?u=${i + 1}`,
          posts: {
            __typename: "PostConnection",
            edges: Array.from({ length: posts }, (_, j) => ({
              __typename: "PostEdge",
              cursor: "p" + (j + 1),
              node: {
                __typename: "Post",
                id: `p-${i + 1}-${j + 1}`,
                title: `Post ${j + 1} by User ${i + 1}`,
                likeCount: likeCount(i + 1, j + 1),
                comments: {
                  __typename: "CommentConnection",
                  edges: Array.from({ length: comments }, (_, k) => ({
                    __typename: "CommentEdge",
                    cursor: "c" + (k + 1),
                    node: {
                      __typename: "Comment",
                      id: `c-${i + 1}-${j + 1}-${k + 1}`,
                      text: `Comment ${k + 1} on Post ${j + 1}`,
                      author: {
                        __typename: "User",
                        id: "u" + ((k % users) + 1),
                        name: "User " + ((k % users) + 1),
                      },
                    },
                  })),
                  pageInfo: {
                    __typename: "PageInfo",
                    endCursor: comments > 0 ? "c" + comments : null,
                    hasNextPage: false,
                  },
                },
              },
            })),
            pageInfo: {
              __typename: "PageInfo",
              endCursor: posts > 0 ? "p" + posts : null,
              hasNextPage: false,
            },
          },
        },
      })),
      pageInfo: {
        __typename: "PageInfo",
        endCursor: users > 0 ? "u" + users : null,
        hasNextPage: false,
      },
    },
  };
};

export const buildPages = ({ data, pageSize }) => {
  const edges = data.users.edges;
  const pages = [];
  const total = edges.length;

  for (let start = 0, pageIdx = 0; start < total; start += pageSize, pageIdx++) {
    const end = Math.min(start + pageSize, total);
    const pageEdges = edges.slice(start, end);
    const endCursor = pageEdges.length ? pageEdges[pageEdges.length - 1].cursor : null;
    const after = pageIdx === 0 ? null : pages[pageIdx - 1].data.users.pageInfo.endCursor;

    const pageData = {
      __typename: "Query",
      users: {
        __typename: "UserConnection",
        edges: pageEdges,
        pageInfo: {
          __typename: "PageInfo",
          endCursor,
          hasNextPage: end < total,
        },
      },
    };

    Object.freeze(pageData);

    pages.push({
      data: pageData,
      after,
      variables: { first: pageSize, after },
    });
  }

  return pages;
};
