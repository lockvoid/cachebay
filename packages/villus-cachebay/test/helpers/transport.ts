import { fetch as villusFetch } from 'villus';
import { delay, tick } from './concurrency';

export type Route = {
  when: (op: { body: string; variables: any; context: any }) => boolean;
  respond: (op: { body: string; variables: any; context: any }) =>
    | { data?: any; error?: any }
    | any;
  delay?: number; // ms
};

type RecordedCall = { body: string; variables: any; context: any };

/** Build a Response compatible object (works in happy-dom too) */
function buildResponse(obj: any) {
  if (typeof Response !== 'undefined') {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return {
    ok: true,
    status: 200,
    async json() { return obj; },
    async text() { return JSON.stringify(obj); },
  } as any;
}
export function createFetchMock(routes: Route[]) {
  const calls: Array<{ body: string; variables: any; context: any }> = [];
  const originalFetch = globalThis.fetch;
  let pending = 0;

  globalThis.fetch = async (_input: any, init?: any) => {
    try {
      const bodyObj =
        init && typeof (init as any).body === 'string'
          ? JSON.parse((init as any).body as string)
          : {};
      const body = bodyObj.query || '';
      const variables = bodyObj.variables || {};
      const context = {};
      const op = { body, variables, context };

      const route = routes.find(r => r.when(op));
      if (!route) {
        // unmatched: return benign payload; do not count as "call"
        return buildResponse({ data: null });
      }

      calls.push(op);
      pending++;
      if (route.delay && route.delay > 0) {
        await delay(route.delay);
      }

      const payload = route.respond(op);
      const resp =
        payload && typeof payload === 'object' && 'error' in payload && (payload as any).error
          ? { errors: [{ message: (payload as any).error?.message || 'Mock error' }] }
          : (payload && typeof payload === 'object' && 'data' in payload
            ? payload
            : { data: payload });

      return buildResponse(resp);
    } finally {
      // ensure we decrement pending even if respond throws
      if (pending > 0) pending--;
    }
  };

  return {
    plugin: villusFetch(),
    calls,
    async waitAll(timeoutMs = 200) {
      const end = Date.now() + timeoutMs;
      while (pending > 0 && Date.now() < end) {
        await tick();
      }
    },
    restore() { globalThis.fetch = originalFetch; },
  };
}
