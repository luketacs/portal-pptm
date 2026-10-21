import { EnsaioIsolamento } from '../models/eletrica-ensaio.model';
import { EnsaioTrafo } from '../models/eletrica-trafo.model';
import { avaliarEnsaio, circuitoLabel, criterioDoEnsaio } from './eletrica-ensaio';
import { avaliarTrafo, circuitoTrafoLabel } from './eletrica-trafo';

// Comparação com o ensaio anterior do mesmo equipamento — pega o isolamento piorando
// antes de reprovar.
// - Resistência de isolamento (corrigida pela temperatura): a IEEE 43 e a NETA mandam
//   acompanhar a tendência, sem número fixo; o portal avisa quando cai 50% ou mais.
// - Resistência ôhmica do trafo (média a 75 °C): NETA MTS 7.2 — deve ficar a 1% do
//   ensaio anterior; avisa acima disso.
// Aviso não reprova: o resultado continua sendo o da norma.

export const QUEDA_IR_ALERTA_PCT = 50;
export const VARIACAO_OHMICA_ALERTA_PCT = 1;

export interface ItemComparacao {
  item: string;
  grandeza: string;
  anterior: number | null;
  atual: number | null;
  variacaoPct: number | null;
  alerta: string | null;
}

// Ensaio imediatamente anterior (por data e, no mesmo dia, pelo número).
export function ensaioAnterior<T extends { id: string; dataEnsaio: string; numero: number }>(lista: T[], atual: T): T | null {
  const antes = lista
    .filter(e => e.id !== atual.id && (e.dataEnsaio < atual.dataEnsaio || (e.dataEnsaio === atual.dataEnsaio && e.numero < atual.numero)))
    .sort((a, b) => b.dataEnsaio.localeCompare(a.dataEnsaio) || b.numero - a.numero);
  return antes[0] ?? null;
}

const variacao = (anterior: number | null, atual: number | null) =>
  anterior !== null && atual !== null && anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;

const alertaQueda = (v: number | null) =>
  v !== null && v <= -QUEDA_IR_ALERTA_PCT ? `Queda de ${Math.round(-v)}% desde o ensaio anterior` : null;

export function compararMotor(atual: EnsaioIsolamento, anterior: EnsaioIsolamento): ItemComparacao[] {
  const a = avaliarEnsaio(atual.medicoes, criterioDoEnsaio(atual));
  const b = avaliarEnsaio(anterior.medicoes, criterioDoEnsaio(anterior));
  const itens: ItemComparacao[] = [];
  a.circuitos.forEach(c => {
    const antes = b.circuitos.find(x => x.circuito === c.circuito);
    if (!antes) return;
    const v = variacao(antes.r1min40, c.r1min40);
    itens.push({ item: circuitoLabel(c.circuito), grandeza: 'IR 1 min a 40 °C (MΩ)', anterior: antes.r1min40, atual: c.r1min40, variacaoPct: v, alerta: alertaQueda(v) });
    if (c.ipSituacao !== 'na' && antes.ipSituacao !== 'na' && c.ip !== null && antes.ip !== null) {
      itens.push({ item: circuitoLabel(c.circuito), grandeza: 'IP', anterior: antes.ip, atual: c.ip, variacaoPct: variacao(antes.ip, c.ip), alerta: null });
    }
  });
  return itens;
}

export function compararTrafo(atual: EnsaioTrafo, anterior: EnsaioTrafo): ItemComparacao[] {
  const a = avaliarTrafo(atual);
  const b = avaliarTrafo(anterior);
  const itens: ItemComparacao[] = [];
  a.isolamento.forEach(c => {
    const antes = b.isolamento.find(x => x.circuito === c.circuito);
    if (!antes) return;
    const v = variacao(antes.r1min20, c.r1min20);
    itens.push({ item: circuitoTrafoLabel(c.circuito), grandeza: 'IR 1 min a 20 °C (MΩ)', anterior: antes.r1min20, atual: c.r1min20, variacaoPct: v, alerta: alertaQueda(v) });
  });
  a.ohmica.forEach(o => {
    const antes = b.ohmica.find(x => x.enrolamento === o.enrolamento);
    if (!antes) return;
    const v = variacao(antes.media75, o.media75);
    itens.push({
      item: `Enrolamento ${o.enrolamento}`, grandeza: 'Resistência ôhmica média a 75 °C (mΩ)', anterior: antes.media75, atual: o.media75, variacaoPct: v,
      alerta: v !== null && Math.abs(v) > VARIACAO_OHMICA_ALERTA_PCT ? `Variou ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (NETA: até 1%)` : null,
    });
  });
  a.ttr.forEach(t => {
    const antes = b.ttr.find(x => x.secundario === t.secundario);
    if (!antes || t.maiorDesvioPct === null || antes.maiorDesvioPct === null) return;
    itens.push({ item: `TTR H/${t.secundario}`, grandeza: 'Maior desvio (%)', anterior: antes.maiorDesvioPct, atual: t.maiorDesvioPct, variacaoPct: null, alerta: null });
  });
  return itens;
}

// Valor da comparação pronto pra tela/PDF (MΩ com casas pela grandeza, mΩ com 3, % com 2).
export function formatarValorComparacao(grandeza: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  if (grandeza.startsWith('IP')) return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (grandeza.includes('mΩ')) return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  if (grandeza.includes('%')) return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const casas = v < 10 ? 2 : v < 100 ? 1 : 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function formatarVariacao(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function linhasComparacao(itens: ItemComparacao[]) {
  return itens.map(i => ({
    item: i.item, grandeza: i.grandeza, anterior: formatarValorComparacao(i.grandeza, i.anterior),
    atual: formatarValorComparacao(i.grandeza, i.atual), variacao: formatarVariacao(i.variacaoPct), alerta: i.alerta,
  }));
}
