// Profile writeQuery operations to find bottlenecks
import { Session } from 'node:inspector';
import { writeFileSync } from 'node:fs';

// ---- cachebay ----
import { createCachebay } from "../../../cachebay/src/core/client";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- relay ----
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import RelayWriteQuery from "../src/__generated__/relayWriteQueryDefRelayWriteQuery.graphql";

// ---- shared ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "../api/utils";

function createCachebay() {
  return createCachebay({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
}

function createApolloCache() {
  return new InMemoryCache({
    resultCaching: false,
    typePolicies: {
      Query: {
        fields: {
          users: relayStylePagination(),
        },
      },
      User: {
        keyFields: ["id"],
        fields: {
          posts: relayStylePagination(),
        },
      },
      Post: {
        keyFields: ["id"],
        fields: {
          comments: relayStylePagination(),
        },
      },
      Comment: { keyFields: ["id"] },
    },
  });
}

function createRelayEnvironment() {
  return new Environment({
    network: Network.create(() => Promise.resolve({ data: {} })),
    store: new Store(new RecordSource()),
  });
}

// Prepare data
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);

console.log(`Profiling writeQuery with ${USERS_TOTAL} users (${pages.length} pages)`);

// Profiler setup
const session = new Session();
session.connect();

function startProfile(name: string) {
  session.post('Profiler.enable');
  session.post('Profiler.start');
  console.log(`\n📊 Starting profile: ${name}`);
}

function stopProfile(name: string) {
  return new Promise<void>((resolve) => {
    session.post('Profiler.stop', (err, { profile }) => {
      if (err) {
        console.error('Profile error:', err);
        resolve();
        return;
      }

      const filename = `profile-${name}.cpuprofile`;
      writeFileSync(filename, JSON.stringify(profile));
      console.log(`✅ Profile saved: ${filename}`);
      console.log(`   Open in Chrome DevTools: chrome://inspect -> Load profile`);
      resolve();
    });
  });
}

async function profileCachebay() {
  startProfile('cachebay-write');

  const cache = createCachebay();

  // Warm up
  for (let i = 0; i < 10; i++) {
    const p = pages[i];
    cache.writeQuery({
      query: CACHEBAY_QUERY,
      variables: p.vars,
      data: p.data,
    });
  }

  // Profile the full write
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    cache.writeQuery({
      query: CACHEBAY_QUERY,
      variables: p.vars,
      data: p.data,
    });
  }

  await stopProfile('cachebay-write');
}

async function profileRelay() {
  startProfile('relay-write');

  const relay = createRelayEnvironment();

  // Warm up
  for (let i = 0; i < 10; i++) {
    const p = pages[i];
    const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
    relay.commitPayload(operation, p.data);
  }

  // Profile the full write
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
    relay.commitPayload(operation, p.data);
  }

  await stopProfile('relay-write');
}

async function profileApollo() {
  startProfile('apollo-write');

  const apollo = createApolloCache();

  // Warm up
  for (let i = 0; i < 10; i++) {
    const p = pages[i];
    apollo.writeQuery({
      broadcast: false,
      query: APOLLO_QUERY,
      variables: p.vars,
      data: p.data,
    });
  }

  // Profile the full write
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    apollo.writeQuery({
      broadcast: false,
      query: APOLLO_QUERY,
      variables: p.vars,
      data: p.data,
    });
  }

  await stopProfile('apollo-write');
}

// Run profiles
async function main() {
  await profileCachebay();
  await new Promise(resolve => setTimeout(resolve, 100));

  await profileRelay();
  await new Promise(resolve => setTimeout(resolve, 100));

  await profileApollo();

  session.disconnect();
  console.log('\n✨ All profiles complete!');
  console.log('Load .cpuprofile files in Chrome DevTools to analyze');
}

main().catch(console.error);
