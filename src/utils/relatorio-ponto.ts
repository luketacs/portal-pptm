// Extrai horas trabalhadas por colaborador a partir do PDF "Espelho do Ponto" —
// usado na reconciliação de horas do Relatório Mensal PCM (Fase 3). Port fiel de
// calcular_horas_disponiveis_ponto (mensal.py), incluindo as regras específicas:
// desconto de almoço fixo por tipo de turno (não o intervalo real batido), seleção
// de qual batida conta como entrada/saída conforme a quantidade de batidas no dia,
// e os marcadores de dia especial (Ausente/Compensado/D.S.R.) que zeram o dia mesmo
// quando há batidas registradas (ex.: sábado com "Compensado" mas horário batido).
//
// Entrada esperada: o texto já extraído de cada página do PDF (uma página por
// colaborador, às vezes 2 páginas pro mesmo colaborador quando o mês é dividido em
// duas quinzenas) — a extração de texto do PDF em si fica a cargo do componente
// (via pdfjs-dist no navegador), essa função só processa o texto resultante.

export type TipoTurno = '4X4' | 'ADM_5X2' | 'OUTRO';

export interface HorasPontoPagina {
  matricula6: string; // sufixo de 6 dígitos da matrícula, extraído do PDF
  turno: TipoTurno;
  horas: number;
}

function normalizarAscii(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function classificarTurno(textoTurno: string): TipoTurno {
  const t = normalizarAscii(textoTurno);
  if (t.includes('4X4')) return '4X4';
  if (t.includes('5X2') || t.includes('ADM')) return 'ADM_5X2';
  return 'OUTRO';
}

// Desconto fixo de almoço por tipo de turno — não é o intervalo real batido entre
// a 2ª e 3ª batida, é sempre esse valor fixo (igual ao original).
function almocoBase(turno: TipoTurno): number {
  return turno === '4X4' ? 1.0 : 0.5;
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function diferencaHoras(entrada: string, saida: string): number {
  const ini = minutos(entrada);
  let fim = minutos(saida);
  if (fim < ini) fim += 24 * 60; // virada de turno (ex.: entra à noite, sai de manhã)
  return (fim - ini) / 60;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Procura uma linha com "MATR" (Matrícula) e pega o último número dela — no
// original vem tipo "Matrícula: 01 - 006162 Nome: FULANO Chapa:", então o último
// número é o que importa (o "01" antes é só um prefixo de filial).
function extrairMatricula6(texto: string): string | null {
  for (const linha of texto.split('\n')) {
    if (normalizarAscii(linha).includes('MATR')) {
      const nums = linha.match(/\d+/g);
      if (nums && nums.length > 0) {
        return nums[nums.length - 1].padStart(6, '0');
      }
    }
  }
  return null;
}

function parseDataBrPonto(str: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

// Divide o texto da página em blocos por dia: cada bloco começa com "DD/MM/AAAA" +
// o nome do dia da semana, e vai até a próxima data, até "Banco de Horas", ou até o
// fim do texto.
function extrairBlocosDia(texto: string): { data: string; bloco: string }[] {
  const regex = /(\d{2}\/\d{2}\/\d{4})\s+\S+\s*([\s\S]*?)(?=\n\d{2}\/\d{2}\/\d{4}\s+\S+|\nBanco de Horas|$)/g;
  const blocos: { data: string; bloco: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(texto)) !== null) {
    blocos.push({ data: match[1], bloco: match[2] });
  }
  return blocos;
}

// Processa o texto de UMA página (um colaborador). Retorna null se a página não for
// um "Espelho do Ponto" de verdade (ex.: página de rosto, sumário) ou não tiver
// matrícula identificável.
export function extrairHorasPontoDePagina(
  textoPagina: string, dataInicio: Date, dataFim: Date,
): HorasPontoPagina | null {
  if (!textoPagina.includes('Espelho do Ponto') || !textoPagina.includes('Data') || !textoPagina.includes('Dia')) {
    return null;
  }

  const matricula6 = extrairMatricula6(textoPagina);
  if (!matricula6) return null;

  const mTurno = /Turno:\s*([^\n]+)/.exec(textoPagina);
  const turno = classificarTurno(mTurno ? mTurno[1] : '');
  const almoco = almocoBase(turno);

  let total = 0;
  for (const { data, bloco } of extrairBlocosDia(textoPagina)) {
    const blocoTrim = bloco.trim();

    // Blocos de dia de verdade sempre começam com uma batida (HH:MM). Um bloco que
    // não começa assim não é um dia com horário registrado.
    if (!/^\d{2}:\d{2}/.test(blocoTrim)) continue;

    // Pula dias sem trabalho de verdade, mesmo que tenham batida registrada (ex.:
    // sábado com horário batido mas marcado como "Compensado").
    if (/Ausente|Compensado|D\.S\.R\.|DSR|\*\*/i.test(bloco)) continue;

    const dataDia = parseDataBrPonto(data);
    if (dataDia && (dataDia < dataInicio || dataDia > dataFim)) continue;

    const todasHoras = bloco.match(/\b\d{2}:\d{2}\b/g) ?? [];
    if (todasHoras.length < 2) continue;

    // Só as 4 primeiras batidas contam (o que vem depois é H.Trab/H.E., que o
    // próprio sistema de ponto já calculou e não precisamos recalcular).
    const batidas = todasHoras.slice(0, 4);
    const entrada = batidas[0];
    const saida = batidas.length >= 4 ? batidas[3] : batidas[1];

    const span = diferencaHoras(entrada, saida);
    const horasDia = span - almoco;
    if (horasDia > 0) total += horasDia;
  }

  return { matricula6, turno, horas: round2(total) };
}

// Agrega várias páginas (um PDF inteiro) — soma quando o mesmo colaborador aparece
// em mais de uma página (mês dividido em duas quinzenas).
export function agregarHorasPonto(
  textosPorPagina: string[], dataInicio: Date, dataFim: Date,
): Map<string, HorasPontoPagina> {
  const totais = new Map<string, HorasPontoPagina>();

  for (const texto of textosPorPagina) {
    const resultado = extrairHorasPontoDePagina(texto, dataInicio, dataFim);
    if (!resultado) continue;

    const existente = totais.get(resultado.matricula6);
    if (existente) {
      existente.horas = round2(existente.horas + resultado.horas);
    } else {
      totais.set(resultado.matricula6, { ...resultado });
    }
  }

  return totais;
}
