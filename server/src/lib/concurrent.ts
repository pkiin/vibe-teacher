/** 결과 순서를 보존하고 한 번에 실행할 IO 수를 제한한다. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await fn(items[index]!, index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}
