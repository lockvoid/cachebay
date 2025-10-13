
export async function timeMs<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  return { ms, value };
}
