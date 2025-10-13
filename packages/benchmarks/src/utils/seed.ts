
export type Post = { id: string; title: string };

function mulberry32(seed: number) {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDataset(count: number, seed = 12345): Post[] {
  const rnd = mulberry32(seed);
  const arr: Post[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const n = Math.floor(rnd() * 1e9).toString(36);
    arr[i] = { id: String(i + 1), title: `Post ${i + 1} • ${n}` };
  }
  return arr;
}
