export const createDeferred = () => {
  let resolve: (value: any) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
