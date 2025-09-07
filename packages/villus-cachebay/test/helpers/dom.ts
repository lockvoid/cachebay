import { tick } from './concurrency';

export async function waitForListText(
  getText: () => string[],
  expected: string[],
  timeoutMs = 120
) {
  const end = Date.now() + timeoutMs;
  for (; ;) {
    if (JSON.stringify(getText()) === JSON.stringify(expected)) return;
    if (Date.now() > end) {
      throw new Error(`timeout waiting for ${JSON.stringify(expected)}; got ${JSON.stringify(getText())}`);
    }
    await tick();
  }
}
