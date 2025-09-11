import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { publish, tick } from '@/test/helpers';

const NON_RELAY_QUERY = /* GraphQL */ `query Q { colors { __typename id name } }`;

describe('Views Integration - non-Relay view tracking', () => {
  it('tracks result objects by default (trackNonRelayResults=true)', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const published = publish(
      cache,
      {
        __typename: 'Query',
        colors: [
          { __typename: 'Color', id: 1, name: 'Black' },
          { __typename: 'Color', id: 2, name: 'Blue' },
        ],
      },
      NON_RELAY_QUERY,
    );

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' }).commit?.();
    await tick();

    expect(published.data.colors[0].name).toBe('Jet Black');
  });

  it('can be disabled via trackNonRelayResults=false', async () => {
    const cache = createCache({
      trackNonRelayResults: false,
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const published = publish(
      cache,
      {
        __typename: 'Query',
        colors: [{ __typename: 'Color', id: 1, name: 'Black' }],
      },
      NON_RELAY_QUERY,
    );

    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Jet Black' }).commit?.();
    await tick();

    expect(published.data.colors[0].name).toBe('Black');
  });
});
