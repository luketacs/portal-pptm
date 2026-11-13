import {
  Alarme, FatoresRolamento, Fundacao, Grandeza, GrupoIso, LeituraVibracao, Situacao, TipoInspecao,
} from '../models/mecanica-vibracao.model';
import { formatarNumero } from './eletrica-ensaio';

// Regras da Análise de Vibração (menu Mecânica).
// STATUS do relatório = zona A/B/C/D da ISO 20816-3, como nos relatórios em Word da equipe.
// O portal sugere: pior ponto de velocidade (mm/s RMS) pela ISO; se o alarme do SKF de algum
// ponto disparar, sobe para C (alerta) ou D (perigo). O inspetor confirma ou muda (ex.: B
// com falha incipiente achada no espectro, mesmo com o global baixo).

export const GRANDEZAS: Grandeza[] = ['velocidade', 'envelope', 'aceleracao', 'temperatura', 'deslocamento'];

export const GRANDEZA_LABEL: Record<Grandeza, string> = {
  envelope: 'Envelope de aceleração',
  velocidade: 'Velocidade',
  aceleracao: 'Aceleração',
  deslocamento: 'Deslocamento',
  temperatura: 'Temperatura',
};

// Unidade como sai no relatório do @ptitude.
export const UNIDADE_PADRAO: Record<Grandeza, string> = {
  envelope: 'gE',
  velocidade: 'mm/s',
  aceleracao: 'g',
  deslocamento: 'µm',
  temperatura: '°C',
};

// Nome de ponto do SKF: "ME 01HA", "BC 03HE03", "ME 02VV", "BC 03TE" — posição (H/V/A) +
// medida (A = aceleração, E = envelope, V = velocidade, D = deslocamento); "TE" = temperatura.
const MEDIDA_DO_NOME: Record<string, Grandeza> = { A: 'aceleracao', E: 'envelope', V: 'velocidade', D: 'deslocamento' };
export function grandezaDoNome(nome: string): Grandeza | null {
  const t = nome.trim();
  if (/\d+\s*TE?\s*$/i.test(t)) return 'temperatura';
  const m = /\d+\s*[HVA]([AEVD])\d*\s*$/i.exec(t);
  return m ? MEDIDA_DO_NOME[m[1].toUpperCase()] : null;
}

export const SITUACOES: Situacao[] = ['A', 'B', 'C', 'D'];

export const SITUACAO_LABEL: Record<Situacao, string> = {
  A: 'A – Excelente',
  B: 'B – Boa',
  C: 'C – Alerta',
  D: 'D – Crítica',
};

// Cores do gráfico de severidade da equipe: verde, amarelo, laranja, vermelho.
export const SITUACAO_BADGE: Record<Situacao, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-yellow-100 text-yellow-800',
  C: 'bg-orange-100 text-orange-800',
  D: 'bg-red-100 text-red-800',
};

// Textos do relatório em Word da equipe.
export const SITUACAO_DESCRICAO: Record<Situacao, string> = {
  A: 'Níveis de vibração compatíveis com condição de máquina nova, sem frequências características de defeitos.',
  B: 'Níveis de vibração aceitáveis, com possível falha incipiente. O equipamento pode operar por longo período, mantendo acompanhamento periódico.',
  C: 'Níveis de vibração insatisfatórios, podendo operar até a próxima preventiva, caso os valores não apresentem evolução. Recomenda-se reduzir o intervalo das coletas de vibração para acompanhamento da anomalia.',
  D: 'Recomenda-se parada do equipamento para intervenção imediata.',
};

export const ALARME_LABEL: Record<Alarme, string> = { normal: 'Normal', alerta: 'Alerta', perigo: 'Perigo' };
export const ALARME_BADGE: Record<Alarme, string> = {
  normal: 'bg-green-100 text-green-800',
  alerta: 'bg-amber-100 text-amber-800',
  perigo: 'bg-red-100 text-red-800',
};

export const TIPO_INSPECAO_LABEL: Record<TipoInspecao, string> = { programada: 'Programada', emergencia: 'Emergência' };

export const GRUPO_ISO_LABEL: Record<GrupoIso, string> = {
  '1': 'Grupo 1 — máquinas grandes, 300 kW a 50 MW',
  '2': 'Grupo 2 — máquinas médias, 15 a 300 kW',
  '3': 'Grupo 3 — bombas > 15 kW, acionador externo',
  '4': 'Grupo 4 — bombas > 15 kW, acionador integrado',
};
export const FUNDACAO_LABEL: Record<Fundacao, string> = { rigida: 'Rígida', flexivel: 'Flexível' };

export const MODOS_FALHA = [
  'Desbalanceamento',
  'Desalinhamento',
  'Folga mecânica',
  'Rolamento — pista externa (BPFO)',
  'Rolamento — pista interna (BPFI)',
  'Rolamento — elementos rolantes (BSF)',
  'Rolamento — gaiola (FTF)',
  'Lubrificação deficiente',
  'Engrenamento',
  'Ressonância',
  'Cavitação / fluxo',
  'Correia / polia',
  'Eixo empenado',
  'Origem elétrica',
  'Base / fixação',
];

// Texto padrão da conclusão para equipamento sem anomalia (do relatório em Word).
export const CONCLUSAO_PADRAO = 'O equipamento apresenta condição vibracional satisfatória, com níveis dentro dos limites aceitáveis conforme a norma ISO 20816-3. '
  + 'A análise dos espectros de vibração não evidencia padrões característicos de falhas mecânicas, indicando operação estável do conjunto. '
  + 'Recomenda-se manter o monitoramento preditivo conforme a periodicidade definida.';

// ── Alarmes do SKF ──────────────────────────────────────────────────────────
export function alarmeLeitura(valor: number | null, alerta: number | null, perigo: number | null): Alarme | null {
  if (valor === null || !Number.isFinite(valor)) return null;
  if (alerta === null && perigo === null) return null;
  if (perigo !== null && valor >= perigo) return 'perigo';
  if (alerta !== null && valor >= alerta) return 'alerta';
  return 'normal';
}

export const alarmeDaLeitura = (l: LeituraVibracao) => alarmeLeitura(l.valor, l.alarmeAlerta, l.alarmePerigo);

// ── ISO 20816-3 ─────────────────────────────────────────────────────────────
// Limites A/B, B/C e C/D em mm/s RMS por grupo e fundação (gráfico de severidade da equipe).
export const LIMITES_ISO: Record<GrupoIso, Record<Fundacao, [number, number, number]>> = {
  '1': { rigida: [2.3, 4.5, 7.1], flexivel: [3.5, 7.1, 11.0] },
  '2': { rigida: [1.4, 2.8, 4.5], flexivel: [2.3, 4.5, 7.1] },
  '3': { rigida: [2.3, 4.5, 7.1], flexivel: [3.5, 7.1, 11.0] },
  '4': { rigida: [1.4, 2.8, 4.5], flexivel: [2.3, 4.5, 7.1] },
};

export function zonaIso(valorMmS: number, grupo: GrupoIso, fundacao: Fundacao): Situacao {
  const [ab, bc, cd] = LIMITES_ISO[grupo][fundacao];
  if (valorMmS <= ab) return 'A';
  if (valorMmS <= bc) return 'B';
  if (valorMmS <= cd) return 'C';
  return 'D';
}

// Zona da leitura pela ISO; null = a norma não se aplica (não é velocidade em mm/s, ou
// falta grupo/fundação no cadastro).
export function zonaDaLeitura(l: LeituraVibracao, grupo: GrupoIso | null, fundacao: Fundacao | null): Situacao | null {
  if (l.grandeza !== 'velocidade' || l.valor === null || !grupo || !fundacao) return null;
  if (!/mm\/s/i.test(l.unidade)) return null;
  return zonaIso(l.valor, grupo, fundacao);
}

const PESO: Record<Situacao, number> = { A: 0, B: 1, C: 2, D: 3 };

export function piorSituacao(lista: (Situacao | null)[]): Situacao | null {
  return lista.reduce<Situacao | null>((pior, s) => (s && (!pior || PESO[s] > PESO[pior]) ? s : pior), null);
}

const ZONA_DO_ALARME: Record<Alarme, Situacao | null> = { normal: null, alerta: 'C', perigo: 'D' };

export interface Sugestao {
  situacao: Situacao | null;
  motivo: string;
}

// Status sugerido: pior zona ISO entre os pontos de velocidade; alarme do SKF em alerta
// sobe para C e em perigo para D.
export function statusSugerido(leituras: LeituraVibracao[], grupo: GrupoIso | null, fundacao: Fundacao | null): Sugestao {
  let pior: Situacao | null = null;
  let motivo = '';
  for (const l of leituras) {
    const zona = zonaDaLeitura(l, grupo, fundacao);
    if (zona && piorSituacao([pior, zona]) !== pior) {
      pior = zona;
      motivo = `${l.ponto}: ${formatarValor(l.valor, l.unidade)} na zona ${zona} da ISO 20816-3`;
    }
    const alarme = alarmeDaLeitura(l);
    const pelaAlarme = alarme ? ZONA_DO_ALARME[alarme] : null;
    if (pelaAlarme && piorSituacao([pior, pelaAlarme]) !== pior) {
      pior = pelaAlarme;
      motivo = `${l.ponto}: alarme de ${alarme} do SKF`;
    }
  }
  if (!pior) {
    const temVelocidade = leituras.some(l => l.grandeza === 'velocidade' && l.valor !== null);
    motivo = !temVelocidade ? 'Sem ponto de velocidade medido.' : 'Cadastre grupo e fundação do equipamento para a ISO sugerir.';
  }
  return { situacao: pior, motivo };
}

// ── Frequências de defeito ──────────────────────────────────────────────────
export interface FrequenciaDefeito {
  codigo: string;
  nome: string;
  hz: number;
}

const NOME_DEFEITO: Record<string, string> = {
  '1X': 'Rotação (desbalanceamento, folga)',
  '2X': '2× rotação (desalinhamento, folga)',
  BPFO: 'Defeito na pista externa',
  BPFI: 'Defeito na pista interna',
  BSF: 'Defeito nos elementos rolantes',
  FTF: 'Defeito na gaiola',
};

export function frequenciasDefeito(rpm: number | null, f: FatoresRolamento): FrequenciaDefeito[] {
  if (!rpm || rpm <= 0) return [];
  const rot = rpm / 60;
  const lista: [string, number | null][] = [['1X', 1], ['2X', 2], ['BPFO', f.bpfo], ['BPFI', f.bpfi], ['BSF', f.bsf], ['FTF', f.ftf]];
  return lista
    .filter((x): x is [string, number] => x[1] !== null && x[1] > 0)
    .map(([codigo, fator]) => ({ codigo, nome: NOME_DEFEITO[codigo], hz: fator * rot }));
}

export interface FrequenciaIdentificada {
  rotulo: string; // "BPFO", "2× BPFO"
  nome: string;
  hzEsperado: number;
  erroPct: number;
}

// Frequência achada pelo inspetor (ex.: 1/Δt entre impactos na forma de onda) contra as
// frequências de defeito e as 3 primeiras harmônicas. Mais próxima primeiro.
export function identificarFrequencia(hz: number | null, rpm: number | null, f: FatoresRolamento, tolerancia = 0.03): FrequenciaIdentificada[] {
  if (hz === null || hz <= 0) return [];
  const saida: FrequenciaIdentificada[] = [];
  for (const d of frequenciasDefeito(rpm, f)) {
    // 1X e 2X já são "harmônicas" entre si: não procura 2× de 1X etc.
    const harmonicas = d.codigo === '1X' || d.codigo === '2X' ? [1] : [1, 2, 3];
    for (const n of harmonicas) {
      const esperado = d.hz * n;
      const erroPct = Math.abs(hz - esperado) / esperado;
      if (erroPct <= tolerancia) saida.push({ rotulo: n === 1 ? d.codigo : `${n}× ${d.codigo}`, nome: d.nome, hzEsperado: esperado, erroPct });
    }
  }
  return saida.sort((a, b) => a.erroPct - b.erroPct);
}

// ── Tendência ───────────────────────────────────────────────────────────────
// % de alteração contra a coleta anterior (mesma conta do relatório "Última medição" do SKF).
export function alteracaoPct(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

// Valor dobrou em relação à coleta anterior do mesmo ponto (+6 dB): vale olhar o
// espectro mesmo com a zona boa. Temperatura fica de fora (dobrar não tem esse sentido).
export function avisoTendencia(atual: number | null, anterior: number | null, grandeza?: Grandeza): string | null {
  if (grandeza === 'temperatura') return null;
  if (atual === null || anterior === null || anterior <= 0) return null;
  const razao = atual / anterior;
  return razao >= 2 ? `Subiu ${formatarNumero(razao, 1)}× desde a coleta anterior.` : null;
}

export function numeroAnalise(n: number): string {
  return `AV-${String(n).padStart(3, '0')}`;
}

export function formatarValor(v: number | null | undefined, unidade?: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const casas = Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : 3;
  return `${formatarNumero(v, casas)}${unidade ? ` ${unidade}` : ''}`;
}

export function formatarPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${formatarNumero(v, 1)}%`;
}
