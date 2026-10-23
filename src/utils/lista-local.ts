// Atualiza a lista em memória com a linha que o banco devolveu na gravação, em vez de
// recarregar a tabela inteira depois de cada insert/update/delete. Quem grava pede a
// linha de volta (supabase-js: .select().single(); REST: Prefer: return=representation)
// e aplica aqui — a tela atualiza na hora e sem uma ida extra ao banco.

type ComId = { id: string };

/** Troca o item de mesmo id; se não estava na lista, insere (no início por padrão). */
export function upsertNaLista<T extends ComId>(
  lista: readonly T[],
  item: T,
  ordenar?: (a: T, b: T) => number,
): T[] {
  const existe = lista.some(x => x.id === item.id);
  const nova = existe ? lista.map(x => (x.id === item.id ? item : x)) : [item, ...lista];
  return ordenar ? nova.sort(ordenar) : nova;
}

/** Aplica vários itens de uma vez (insert em lote). */
export function upsertVariosNaLista<T extends ComId>(
  lista: readonly T[],
  itens: readonly T[],
  ordenar?: (a: T, b: T) => number,
): T[] {
  const porId = new Map(itens.map(i => [i.id, i]));
  const nova = lista.map(x => porId.get(x.id) ?? x);
  const existentes = new Set(lista.map(x => x.id));
  const novos = itens.filter(i => !existentes.has(i.id));
  const resultado = [...novos, ...nova];
  return ordenar ? resultado.sort(ordenar) : resultado;
}

export function removerDaLista<T extends ComId>(lista: readonly T[], id: string): T[] {
  return lista.filter(x => x.id !== id);
}
