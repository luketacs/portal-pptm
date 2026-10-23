// Montagem visual do quadro de LOTO (ver quadro-loto-tabela): dias seguidos com a mesma
// situação viram uma faixa só, e os conflitos viram texto legível. Matemática pura,
// sem Angular — testada em quadro-loto-layout.spec.ts.

export interface ItemLoto {
  status: string;
  descricao: string;
  tecnicos: string[];
  numeroOs: string | null;
}

export interface DiaLoto {
  data: string;
  itens: ItemLoto[];
  conflito: boolean;
}

export interface SegmentoLoto {
  inicio: number;   // índice do primeiro dia (0 = SEG)
  dias: number;     // quantos dias seguidos
  datas: string[];
  itens: ItemLoto[];
  conflito: boolean;
}

const ABREVIACAO: Record<string, string> = {
  LOTO: 'LOTO',
  FUNCIONANDO: 'FUNC',
  'DISPONÍVEL': 'DISP',
  DISPONIVEL: 'DISP',
};

export function abreviarStatusLoto(status: string): string {
  const s = status.trim().toUpperCase();
  return ABREVIACAO[s] ?? s.slice(0, 4);
}

// Rótulo da faixa: "LOTO", ou "LOTO × FUNC" quando há conflito (status distintos, na
// ordem em que aparecem). DISPONÍVEL repetido também é conflito — vira "DISP × DISP".
export function rotuloSegmento(seg: { itens: ItemLoto[]; conflito: boolean }): string {
  const abreviados = seg.itens.map(i => abreviarStatusLoto(i.status));
  if (!seg.conflito) return abreviados[0] ?? '';
  const distintos = [...new Set(abreviados)];
  return (distintos.length > 1 ? distintos : abreviados).join(' × ');
}

// Mesma situação: sem conflito, basta o mesmo status (o equipamento continua bloqueado/
// ligado, mesmo que a OS ou o técnico mude de um dia pro outro — a faixa junta as OS).
// Com conflito, só junta se for exatamente o mesmo conflito (mesmas OS e status).
function assinatura(dia: DiaLoto): string {
  if (!dia.conflito) return [...new Set(dia.itens.map(i => i.status.toUpperCase()))].sort().join(';');
  return dia.itens
    .map(i => `${i.numeroOs ?? i.descricao}|${i.status.toUpperCase()}`)
    .sort()
    .join(';') + '#c';
}

function chaveItem(i: ItemLoto): string {
  return `${i.numeroOs ?? i.descricao}|${i.status.toUpperCase()}`;
}

// Junta os itens dos dias da faixa sem repetir OS; técnicos somados sem repetir.
function juntarItens(atuais: ItemLoto[], novos: ItemLoto[]): ItemLoto[] {
  const porChave = new Map(atuais.map(i => [chaveItem(i), { ...i, tecnicos: [...i.tecnicos] }]));
  for (const n of novos) {
    const existente = porChave.get(chaveItem(n));
    if (existente) existente.tecnicos = [...new Set([...existente.tecnicos, ...n.tecnicos])];
    else porChave.set(chaveItem(n), { ...n, tecnicos: [...new Set(n.tecnicos)] });
  }
  return [...porChave.values()];
}

export function segmentosDaLinha(dias: DiaLoto[]): SegmentoLoto[] {
  const segmentos: SegmentoLoto[] = [];
  let atual: SegmentoLoto | null = null;
  let assinaturaAtual = '';
  dias.forEach((dia, i) => {
    if (dia.itens.length === 0) { atual = null; return; }
    const ass = assinatura(dia);
    if (atual && ass === assinaturaAtual) {
      atual.dias++;
      atual.datas.push(dia.data);
      atual.itens = juntarItens(atual.itens, dia.itens);
      return;
    }
    atual = { inicio: i, dias: 1, datas: [dia.data], itens: juntarItens([], dia.itens), conflito: dia.conflito };
    assinaturaAtual = ass;
    segmentos.push(atual);
  });
  return segmentos;
}

// Resumo em texto dos conflitos de um equipamento, um por faixa:
// { dias: 'SEG', texto: 'LOTO (Eduarda) × FUNCIONANDO (Mauro)', os: ['048018', '046320'] }
export function resumoConflitos(
  dias: DiaLoto[], rotulos: { data: string; label: string }[],
): { dias: string; texto: string; os: string[]; segmento: SegmentoLoto }[] {
  const rotuloDe = new Map(rotulos.map(r => [r.data, r.label]));
  return segmentosDaLinha(dias)
    .filter(s => s.conflito)
    .map(s => {
      const primeiro = rotuloDe.get(s.datas[0]) ?? s.datas[0];
      const ultimo = rotuloDe.get(s.datas[s.datas.length - 1]) ?? s.datas[s.datas.length - 1];
      return {
        dias: s.dias > 1 ? `${primeiro}–${ultimo}` : primeiro,
        texto: s.itens.map(i => `${i.status} (${i.tecnicos.join(', ')})`).join(' × '),
        os: s.itens.map(i => i.numeroOs).filter((n): n is string => !!n),
        segmento: s,
      };
    });
}
