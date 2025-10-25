#!/usr/bin/env node
import { startNestedServer } from '../src/server/schema-nested.js';
import { makeNestedDataset } from '../src/utils/seed-nested.js';

const USER_COUNT = 1000; // 100 pages * 10 users per page
const POSTS_PER_USER = 20;
const COMMENTS_PER_POST = 10;
const FOLLOWERS_PER_USER = 15;

async function main() {
  const dataset = makeNestedDataset({
    userCount: USER_COUNT,
    postsPerUser: POSTS_PER_USER,
    commentsPerPost: COMMENTS_PER_POST,
    followersPerUser: FOLLOWERS_PER_USER,
    seed: 10000,
  });
  const server = await startNestedServer(dataset, { artificialDelayMs: 20, port: 4001 });
  
  console.log(`Server started at ${server.url}`);
  console.log('Press Ctrl+C to stop');
  
  // Keep the process alive
  process.on('SIGINT', async () => {
    console.log('\nStopping server...');
    await server.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
