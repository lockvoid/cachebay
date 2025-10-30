
import * as sse from "graphql-sse"; // Optional

const ws = ({ query, variables }) => {
  const sseClient = sse.createClient({ url: '/graphql' });

  return ({ query, variables }) => {
    return {
      subscribe: (observer: any) => {
        const unsubscribe = sseClient.subscribe({ query, variables }, {
          next: (value) => {
            observer.next({ data: value.data ?? null, error: value.errors?.[0] ?? null });
          },

          error: (error) => {
            observer.error(error);
          },

          complete: () => {
            observer.completex();
          },
        });

        return { unsubscribe };
      },
    };
  };
};
