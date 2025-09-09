export const getPk = (globalId: string) => {
  const [_1, _2, _3, ...pk] = JSON.parse(atob(globalId));

  return pk.length === 1 ? pk[0] : pk;
}
