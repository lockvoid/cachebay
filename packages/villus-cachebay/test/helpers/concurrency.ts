export const tick = async (count) => {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const raf = () => {
  return new Promise((resolve) =>
    (globalThis as any).requestAnimationFrame ? requestAnimationFrame(() => resolve()) : setTimeout(() => resolve(), 16),
  );
}
