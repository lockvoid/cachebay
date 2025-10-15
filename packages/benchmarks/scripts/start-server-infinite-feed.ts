#!/usr/bin/env node
import { startServer } from '../src/server/schema.js';
import { makeDataset } from '../src/utils/seed.js';

const PAGE_SIZE = 50;
const PAGES_TO_LOAD = 100;
const TOTAL_ROWS = PAGE_SIZE * (PAGES_TO_LOAD + 2);

async function main() {
  const dataset = makeDataset(TOTAL_ROWS, 10000);
  const server = await startServer(dataset, { artificialDelayMs: 20, port: 4000 });
  
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
