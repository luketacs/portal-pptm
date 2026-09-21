/** Busca todas as páginas, inclusive quando o servidor aplica um limite menor. */
export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Tamanho de página inválido.');
  const rows: T[] = [];
  for (;;) {
    const page = await query(rows.length, rows.length + pageSize - 1);
    if (page.error) return { data: [], error: page.error };
    if (!page.data?.length) return { data: rows, error: null };
    rows.push(...page.data);
  }
}
