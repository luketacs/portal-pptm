import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairJsonObjects } from '../api/_sigma-material-shared.js';
import { fetchAllRows } from '../api/_pagination-shared.js';
import { resumirDisponibilidade } from '../api/_indicadores-hh-shared.js';
import apontamentos from '../api/apontamentos.js';

test('SIGMA: chaves e aspas escapadas na descrição não quebram JSON concatenado', () => {
  const records = [{ success: true, data: { texto_breve: 'Peça } { "especial" \\ A' } }, { saldo: 3 }];
  assert.deepEqual(extrairJsonObjects('aviso } ' + records.map(JSON.stringify).join('\n')), records);
});

test('paginação do backend aceita limite do servidor menor e propaga falhas', async () => {
  const rows = [1, 2, 3];
  assert.deepEqual(await fetchAllRows(async from => ({ data: rows.slice(from, from + 1) })), rows);
  await assert.rejects(fetchAllRows(async from => from ? { error: { message: 'falha' } } : { data: [1] }), /falha/);
});

test('apontamentos exige autenticação antes de consultar o banco', async () => {
  const res = {
    setHeader() {}, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await apontamentos({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 401);
  assert.equal(res.body.data, undefined);
});

test('resumo público preserva HH, conta ausências sobrepostas uma vez e omite motivos/datas individuais', () => {
  const colaboradores = [
    { nome: 'Técnico Teste', matricula: '1', area: 'MECANICA', disponibilidade: 6.5 },
    { nome: 'ALEXANDRE GOMES', matricula: '2', area: 'ELETRICA', disponibilidade: 6.5 },
  ];
  const ordens = [{ tipo: 'folga', tecnicoMatricula: '1', semanaInicio: '2026-09-21', diasPrevistos: ['2026-09-21'] }];
  const ausencia = { tecnicoMatricula: '1', dataInicio: '2026-09-21', dataFim: '2026-09-22', motivo: 'PRIVADO' };
  const resumo = resumirDisponibilidade(ordens, [ausencia, ausencia], colaboradores, [2026]);
  assert.deepEqual(resumo['2026-09-21'], {
    disponivel: 19.5, indisponivel: 13, porTecnico: { '1': 19.5 }, exames: 0, folgas: 1,
  });
  assert.ok(!JSON.stringify(resumo).includes('PRIVADO'));
  assert.ok(!JSON.stringify(resumo).includes('dataInicio'));
  assert.ok(resumo['2026-09-07'].porTecnico['2'] > 0);
});

// ── Fundo Fixo: aprovação pelo Teams ────────────────────────────────────
import { notificarTeams, handleDecisaoVer, handleDecisaoConfirmar } from '../api/fundo-fixo-public-request.js';
import { gestorDaSolicitacao, hashToken, interpretarDecisao } from '../api/_fundo-fixo-teams-shared.js';

// Supabase falso, só o suficiente pros filtros usados (eq/is/gt + select/update/insert).
function fakeSupabase(rows) {
  const logs = [];
  return {
    rows, logs,
    from(table) {
      if (table === 'audit_logs') return { insert: async r => { logs.push(r); return { error: null }; } };
      const filtros = [];
      let patch = null;
      const alvo = () => rows.filter(r => filtros.every(f => f(r)));
      const q = {
        select() { return q; },
        update(p) { patch = p; return q; },
        eq(c, v) { filtros.push(r => r[c] === v); return q; },
        is(c, v) { filtros.push(r => (r[c] ?? null) === v); return q; },
        gt(c, v) { filtros.push(r => r[c] > v); return q; },
        async maybeSingle() { return { data: alvo()[0] ?? null, error: null }; },
        then(resolve) {
          const achadas = alvo();
          if (patch) achadas.forEach(r => Object.assign(r, patch));
          resolve({ data: achadas.map(r => ({ ...r })), error: null });
        },
      };
      return q;
    },
  };
}

const ID = '11111111-2222-3333-4444-555555555555';
const env = { FUNDO_FIXO_FLOW_URL: 'https://flow', FUNDO_FIXO_EMAIL_JOAO: 'joao@x', FUNDO_FIXO_EMAIL_ITALO: 'italo@x' };
const novaRow = extra => ({ id: ID, status: 'pendente', setor: 'Operação', solicitante_nome: 'Ana', material: 'Luva', valor_estimado: 120, teams_enviado_em: null, gestor_aprovador: null, ...extra });
const fakeRes = () => ({ status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const ipUnico = () => `ip-${Math.random()}`;

// Envia o card e devolve o token que foi no link do botão Aprovar.
async function enviarECapturarToken(sb) {
  const enviados = [];
  await notificarTeams(sb, ID, env, async (url, opts) => { enviados.push(JSON.parse(opts.body)); return { ok: true }; });
  const url = new URL(enviados[0].card.actions[0].url);
  return { token: url.searchParams.get('t'), enviados };
}

test('Teams: gestor por setor — Operação João, Manutenção/Infra Italo, Outros só se já indicado', () => {
  assert.equal(gestorDaSolicitacao({ setor: 'Operação' }), 'João Nunes');
  assert.equal(gestorDaSolicitacao({ setor: 'Manutenção' }), 'Italo Rosse');
  assert.equal(gestorDaSolicitacao({ setor: 'Infraestrutura' }), 'Italo Rosse');
  assert.equal(gestorDaSolicitacao({ setor: 'Outros', gestor_aprovador: null }), null);
  assert.equal(gestorDaSolicitacao({ setor: 'Outros', gestor_aprovador: 'João Nunes' }), 'João Nunes');
});

test('Teams: envia uma vez só, pro gestor do setor, com links de decisão; banco guarda só o hash', async () => {
  const sb = fakeSupabase([novaRow()]);
  const { token, enviados } = await enviarECapturarToken(sb);
  assert.equal(await notificarTeams(sb, ID, env, async () => assert.fail('não devia reenviar')), 'ja-enviada');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].aprovadorEmail, 'joao@x');
  assert.match(enviados[0].card.actions[1].url, /\/publico\/fundo-fixo\/decisao\?t=.+&d=recusar$/);
  assert.equal(sb.rows[0].gestor_aprovador, 'João Nunes');
  assert.equal(sb.rows[0].teams_token_hash, hashToken(token));
  assert.ok(!JSON.stringify(sb.rows[0]).includes(token));
});

test('Teams: falha no fluxo desmarca pra poder reenviar; Outros sem gestor não envia', async () => {
  const sb = fakeSupabase([novaRow({ setor: 'Manutenção' })]);
  assert.equal(await notificarTeams(sb, ID, env, async () => ({ ok: false, status: 500 })), 'falhou');
  assert.equal(sb.rows[0].teams_enviado_em, null);
  assert.equal(sb.rows[0].teams_token_hash, null);
  const outros = fakeSupabase([novaRow({ setor: 'Outros' })]);
  assert.equal(await notificarTeams(outros, ID, env, async () => assert.fail('não devia enviar')), 'sem-gestor');
});

test('Teams: ver não decide; confirmar recusa grava motivo, avisa o gestor e não decide duas vezes', async () => {
  const sb = fakeSupabase([novaRow()]);
  const { token } = await enviarECapturarToken(sb);

  let res = fakeRes();
  await handleDecisaoVer({ body: { token } }, res, ipUnico(), sb);
  assert.equal(res.body.solicitacao.material, 'Luva');
  assert.equal(res.body.solicitacao.teams_token_hash, undefined);
  assert.equal(sb.rows[0].status, 'pendente');

  res = fakeRes();
  await handleDecisaoVer({ body: { token: 'x'.repeat(43) } }, res, ipUnico(), sb);
  assert.equal(res.code, 404);

  const confirmacoes = [];
  const fetchConf = async (url, opts) => { confirmacoes.push(JSON.parse(opts.body)); return { ok: true }; };
  res = fakeRes();
  await handleDecisaoConfirmar({ body: { token, decisao: 'recusar', comentario: 'caro "demais"\nmesmo' } }, res, ipUnico(), sb, env, fetchConf);
  assert.equal(res.body.success, true);
  assert.equal(sb.rows[0].status, 'recusado');
  assert.equal(sb.rows[0].motivo_recusa, 'caro "demais"\nmesmo');
  assert.equal(sb.rows[0].aprovador_nome, 'João Nunes (Teams)');
  assert.equal(sb.logs.length, 1);
  assert.equal(confirmacoes[0].aprovadorEmail, 'joao@x');

  res = fakeRes();
  await handleDecisaoConfirmar({ body: { token, decisao: 'aprovar' } }, res, ipUnico(), sb, env, fetchConf);
  assert.equal(res.code, 409);
  assert.equal(sb.rows[0].status, 'recusado');
});

test('Teams: link expirado não decide; decisão do Admin no portal prevalece', async () => {
  const sb = fakeSupabase([novaRow()]);
  const { token } = await enviarECapturarToken(sb);
  sb.rows[0].teams_token_expira_em = new Date(Date.now() - 1000).toISOString();
  let res = fakeRes();
  await handleDecisaoConfirmar({ body: { token, decisao: 'aprovar' } }, res, ipUnico(), sb, env, async () => ({ ok: true }));
  assert.equal(res.code, 409);
  assert.match(res.body.error, /expirou/);
  assert.equal(sb.rows[0].status, 'pendente');

  sb.rows[0].teams_token_expira_em = new Date(Date.now() + 60000).toISOString();
  sb.rows[0].status = 'aprovado';
  res = fakeRes();
  await handleDecisaoConfirmar({ body: { token, decisao: 'recusar' } }, res, ipUnico(), sb, env, async () => ({ ok: true }));
  assert.equal(res.code, 409);
  assert.equal(sb.rows[0].status, 'aprovado');
  assert.equal(interpretarDecisao({ token, decisao: 'talvez' }).erro, 'Decisão inválida.');
});
