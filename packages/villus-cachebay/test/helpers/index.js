export const tick = () => {
  return new Promise(resolve => setTimeout(resolve, 0));
};

export const raf = () => {
  return new Promise(resolve => requestAnimationFrame(resolve));
};

export const delay = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};
