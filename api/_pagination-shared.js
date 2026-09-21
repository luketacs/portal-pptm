export async function fetchAllRows(query, pageSize = 1000) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Tamanho de página inválido.');
  const rows = [];
  for (;;) {
    const { data, error } = await query(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
