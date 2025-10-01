import { useSubscription } from 'villus';

export const HOGWARTS_TIME_FIELDS = `
  fragment HogwartsTimeFields on HogwartsTime {
    id
    time
  }
`;

export const HOGWARTS_TIME_UPDATED = `
  subscription HogwartsTimeUpdated {
    hogwartsTimeUpdated {
      id
      time
    }
  }
`;

export const useHogwartsTime = () => {
  return useSubscription({ query: HOGWARTS_TIME_UPDATED }, ({ data, error }) => {
    if (error) {
      console.log('Error subscribing to Hogwarts time:', error);
    }

    if (data) {
      // console.log('Hogwarts time:', data.hogwartsTimeUpdated);
    }
  });
};
