// Persiste o último relatório PCM gerado (Mensal/Semanal) no localStorage do
// navegador, pra não sumir quando o usuário navega pra outra página e volta ou
// atualiza o navegador. Só o resultado já calculado é salvo (não os arquivos
// enviados, que podem ser grandes demais e não fazem sentido guardar). Wrapper
// fino sobre a API do navegador — sem lógica de negócio, por isso sem spec
// dedicado (igual às chamadas de XLSX.read/pdfjs nos componentes).

export function salvarLocal<T>(chave: string, valor: T): void {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // localStorage indisponível (modo privado, cota excedida etc.) — só afeta a
    // persistência entre sessões, não o relatório atual na tela.
  }
}

export function carregarLocal<T>(chave: string): T | null {
  try {
    const raw = localStorage.getItem(chave);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function removerLocal(chave: string): void {
  try {
    localStorage.removeItem(chave);
  } catch {
    // ignora
  }
}
