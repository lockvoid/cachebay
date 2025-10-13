
import type { Post } from './seed';

export type Edge = { cursor: string; node: Post };
export type Connection = { edges: Edge[]; pageInfo: { endCursor: string | null; hasNextPage: boolean } };

export function renderList(edges: Edge[]): number {
  let sum = 0;
  for (let i = 0; i < edges.length; i++) {
    const t = edges[i].node.title;
    for (let j = 0; j < t.length; j++) sum = (sum * 33 + t.charCodeAt(j)) >>> 0;
  }
  return sum;
}
