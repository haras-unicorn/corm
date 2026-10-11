export const matchTaggedUnionExhaustively = <
  K extends PropertyKey,
  U extends { [P in K]: PropertyKey },
  H extends { [V in U[K]]: (union: Extract<U, { [P in K]: V }>) => unknown },
>(
  key: K,
  union: U,
  handlers: H,
): ReturnType<H[U[K]]> => {
  const handler = handlers[union[key]] as (union: U) => ReturnType<H[U[K]]>;
  return handler(union);
};
