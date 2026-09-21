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
