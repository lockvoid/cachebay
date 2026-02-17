import { createCachebay } from "cachebay";
import * as sse from "graphql-sse";
import type { HttpContext, OperationResult } from "cachebay";

const createHttpTransport = (url: string) => {
  return async (ctx: HttpContext): Promise<OperationResult> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ctx.query,
          variables: ctx.variables,
        }),
      });

      const result = await response.json();

      return { data: result.data, error: result.errors?.[0] };
    } catch (error) {
      return { data: null, error };
    }
  };
};

const createWsTransport = (url: string) => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const sseClient = sse.createClient({ url });

  return ({ query, variables }: { query: string; variables?: any }) => {
    return {
      subscribe: (observer: any) => {
        const unsubscribe = sseClient.subscribe({ query, variables }, {
          next: (value: any) => {
            observer.next?.({ data: value.data, error: value.errors?.[0] ? new Error(value.errors[0].message) : null });
          },

          error: (error: any) => {
            observer.error?.(error);
          },

          complete: () => {
            observer.complete?.();
          },
        });

        return { unsubscribe };
      },
    };
  };
};

export const createCachebayInstance = (cachePolicy: string) => {
  const url = "/api/graphql";

  return createCachebay({
    cachePolicy: cachePolicy as any,

    transport: {
      http: createHttpTransport(url),
      ws: createWsTransport(url),
    },
  });
};
