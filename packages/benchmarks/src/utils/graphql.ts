export const delay = (ms: number) => {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
};

export const encodeCursor = (index: number) => {
  if (typeof btoa !== 'undefined') {
    return btoa(`cursor:${index}`);
  }

  return Buffer.from(`cursor:${index}`, 'utf8').toString('base64');
};

export const decodeCursor = (cursor: string | null | undefined) => {
  if (!cursor) {
    return -1;
  }

  try {
    let decoded: string;

    if (typeof atob !== 'undefined') {
      decoded = atob(cursor);
    } else {
      decoded = Buffer.from(cursor, 'base64').toString('utf8');
    }

    const match = decoded.match(/^cursor:(\d+)$/);
    return match ? parseInt(match[1], 10) : -1;
  } catch {
    return -1;
  }
};

export const paginateArray = <T>(arr: T[], first: number, after?: string) => {
  const startIndex = decodeCursor(after) + 1;
  const slice = arr.slice(startIndex, startIndex + first);

  const edges = slice.map((node, i) => ({
    cursor: encodeCursor(startIndex + i),
    node,
  }));

  const endIndex = startIndex + slice.length - 1;
  const startCursor = slice.length > 0 ? encodeCursor(startIndex) : null;
  const endCursor = slice.length > 0 ? encodeCursor(endIndex) : null;
  const hasPreviousPage = startIndex > 0;
  const hasNextPage = endIndex < arr.length - 1;

  return {
    edges,
    pageInfo: { startCursor, endCursor, hasPreviousPage, hasNextPage },
  };
};

export const createYogaFetcher = (yoga: any, serverUrl: string) => {
  return async (query: string, variables: any) => {
    const response = await yoga.fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    return await response.json();
  };
};
