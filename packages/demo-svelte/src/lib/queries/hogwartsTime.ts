import { createSubscription } from "cachebay/svelte";

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
  return createSubscription({ query: HOGWARTS_TIME_UPDATED }, ({ data, error }: any) => {
    if (error) {
      console.log("Error subscribing to Hogwarts time:", error);
    }

    if (data) {
      console.log("Hogwarts time:", data.hogwartsTimeUpdated);
    }
  });
};
