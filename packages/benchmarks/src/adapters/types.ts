
import type { Connection } from '../utils/concurrency';

export type FeedResult = Connection;

export type Adapter = {
  name: string;
  setup(opts: { url: string }): Promise<{ stop?: () => Promise<void> }>;
  fetchPage(opts: { first: number; after?: string | null }): Promise<FeedResult>;
  teardown(): Promise<void>;
};
