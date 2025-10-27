import type { Connection } from "../utils/concurrency";

export type FeedResult = Connection;

export type Adapter = {
  name: string;
  setup(options: { url: string }): Promise<{ stop?: () => Promise<void> }>;
  fetchPage(options: { first: number; after?: string | null }): Promise<FeedResult>;
  teardown(): Promise<void>;
};
