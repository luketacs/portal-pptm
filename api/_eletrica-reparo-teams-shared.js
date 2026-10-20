// Módulo compartilhado — NÃO é uma rota (Vercel ignora arquivos com "_" na frente em
// api/). Aviso no Teams do supervisor de elétrica quando alguém abre uma Solicitação de
// Reparo Externo. Usa o mesmo fluxo do Power Automate do Fundo Fixo (FUNDO_FIXO_FLOW_URL,
// que só recebe { aprovadorEmail, card } e posta no chat) — aqui o card só avisa, com um
// botão pro relatório no portal; o supervisor atualiza o status lá (login normal).
//
// A action fica dentro de api/fundo-fixo-public-request.js porque o plano Hobby da
// Vercel limita o deploy a 12 functions e api/ já está no limite.

import { portalUrl } from './_fundo-fixo-teams-shared.js';

// Número do chamado: 7 → "RE-007". Precisa ficar em sincronia com numeroReparo em
// src/utils/eletrica-reparo.ts
export function numeroReparo(numero) {
  return numero ? `RE-${String(numero).padStart(3, '0')}` : '';
}

// E-mail (conta do Teams) do supervisor fica em variável de ambiente, não no código.
export function emailSupervisor(env = process.env) {
  return (env.ELETRICA_SUPERVISOR_EMAIL || '').trim() || null;
}

const SCHEMA = { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4' };

export function montarCardReparo(row, baseUrl) {
  const facts = [{ title: 'Aberto por', value: row.solicitante_nome }];
  if (row.fabricante_modelo) facts.push({ title: 'Fabricante / Modelo', value: row.fabricante_modelo });
  if (row.tag_sap) facts.push({ title: 'TAG / SAP', value: row.tag_sap });
  if (row.localizacao) facts.push({ title: 'Localização', value: row.localizacao });
  const defeitos = Array.isArray(row.defeitos) ? row.defeitos.map(d => d?.titulo).filter(Boolean) : [];
  if (defeitos.length) facts.push({ title: 'Defeitos', value: defeitos.join('; ') });

  return {
    ...SCHEMA,
    body: [
      {
        type: 'Container', style: 'emphasis', bleed: true,
        items: [
          { type: 'TextBlock', text: `ELÉTRICA · REPARO EXTERNO · ${numeroReparo(row.numero)}`, size: 'Small', weight: 'Bolder', color: 'Accent', spacing: 'None', wrap: true },
          { type: 'TextBlock', text: row.equipamento, size: 'Large', weight: 'Bolder', wrap: true, maxLines: 3, spacing: 'Small' },
        ],
      },
      { type: 'TextBlock', text: row.resumo, wrap: true, maxLines: 6, spacing: 'Medium' },
      { type: 'FactSet', facts, spacing: 'Medium', separator: true },
    ],
    actions: [{ type: 'Action.OpenUrl', title: 'Abrir relatório', url: `${baseUrl}/eletrica/reparos/${row.id}` }],
  };
}

// Manda o aviso uma vez só por solicitação (teams_enviado_em). Devolve um motivo curto;
// nunca lança — falha aqui não pode derrubar a abertura da solicitação.
export async function notificarReparo(supabase, id, env = process.env, fetchImpl = fetch, timeoutMs = 8000) {
  if (!env.FUNDO_FIXO_FLOW_URL) return 'desligado';
  const email = emailSupervisor(env);
  if (!email) return 'sem-supervisor';
  let marcou = false;
  try {
    const { data: row, error } = await supabase.from('eletrica_reparos').select('*').eq('id', id).maybeSingle();
    if (error || !row) return 'nao-encontrada';
    if (row.teams_enviado_em) return 'ja-enviada';

    // Marca antes de enviar (só quem conseguir marcar envia) — evita aviso duplicado.
    const { data: marcadas } = await supabase
      .from('eletrica_reparos')
      .update({ teams_enviado_em: new Date().toISOString() })
      .eq('id', id).is('teams_enviado_em', null)
      .select('id');
    if (!marcadas?.length) return 'ja-enviada';
    marcou = true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchImpl(env.FUNDO_FIXO_FLOW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aprovadorEmail: email, card: montarCardReparo(row, portalUrl(env)) }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`fluxo respondeu ${resp.status}`);
    } finally {
      clearTimeout(timer);
    }
    return 'enviada';
  } catch (err) {
    console.error('[eletrica-reparo-teams] Falha ao enviar pro Teams:', err?.message || err);
    if (marcou) await supabase.from('eletrica_reparos').update({ teams_enviado_em: null }).eq('id', id);
    return 'falhou';
  }
}
