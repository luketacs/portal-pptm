// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Rate-limiting simples em memória (janela fixa), antes reimplementado quase
// idêntico em 6 functions serverless (create-user, reset-user-password,
// fundo-fixo-public-request, export-materials, export-requests, telegram-material-bot) —
// extraído aqui, mesmo padrão já usado pra outras duplicações deste diretório (ver
// _sigma-shared.js, _sigma-material-shared.js). Em memória por instância — não
// compartilhado entre instâncias concorrentes da Vercel, então é proteção leve contra
// abuso, não uma garantia dura.
//
// createRateLimiter({windowMs, max}) devolve uma função checkRateLimit(chave) que retorna
// true quando a chamada é PERMITIDA (dentro do limite) e false quando deve ser bloqueada —
// permite exatamente `max` chamadas por janela de `windowMs`, igual todas as 6
// implementações originais (só variavam na sintaxe/sentido do booleano, nunca no limite
// de fato). `maxEntries` (opcional) limita o tamanho do Map via eviction do mais antigo —
// só o bot do Telegram (chave = chat_id, não IP) tinha essa proteção extra; os outros 5
// continuam sem, pra não mudar o comportamento de quem não pedia isso.
export function createRateLimiter({ windowMs, max, maxEntries }) {
  const map = new Map();
  return function checkRateLimit(chave) {
    const now = Date.now();
    const entry = map.get(chave);
    if (!entry || now - entry.start > windowMs) {
      map.set(chave, { start: now, count: 1 });
      if (maxEntries && map.size > maxEntries) {
        map.delete(map.keys().next().value);
      }
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
