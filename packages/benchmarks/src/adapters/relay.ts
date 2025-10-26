import { Environment, Network, RecordSource, Store } from 'relay-runtime';

export type RelayEnvironmentConfig = {
  yoga: any;
  serverUrl: string;
};

/**
 * Creates a Relay Environment configured for nested query benchmarks
 * Uses Yoga directly (in-memory, no HTTP)
 */
export function createRelayEnvironment({ yoga, serverUrl }: RelayEnvironmentConfig) {
  // Custom fetch function using Yoga directly (in-memory, no HTTP)
  async function fetchQuery(operation: any, variables: any) {
    const response = await yoga.fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: operation.text,
        variables,
      }),
    });

    return await response.json();
  }

  const environment = new Environment({
    network: Network.create(fetchQuery),
    store: new Store(new RecordSource()),
  });

  return environment;
}
