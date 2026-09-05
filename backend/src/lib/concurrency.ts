// Pool de concurrencia simple: procesa `items` con `fn`, como maximo
// `limit` a la vez. El pipeline por escena (search_stock, keywords, etc.)
// corria una escena a la vez -- con 20-30 escenas eso son minutos de
// espera secuencial y ninguna ventaja real (cada escena es independiente).
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
