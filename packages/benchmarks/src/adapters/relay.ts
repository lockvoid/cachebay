import { Environment, Network, RecordSource, Store } from 'relay-runtime';
import { createYogaFetcher } from '../utils/graphql';

export type RelayEnvironmentConfig = {
  yoga: any;
  serverUrl: string;
};

export const createRelayEnvironment = ({ yoga, serverUrl }: RelayEnvironmentConfig) => {
  const fetcher = createYogaFetcher(yoga, serverUrl);

  const fetchQuery = async (operation: any, variables: any) => {
    return await fetcher(operation.text, variables);
  };

  const environment = new Environment({
    network: Network.create(fetchQuery),
    store: new Store(new RecordSource()),
  });

  return environment;
}
