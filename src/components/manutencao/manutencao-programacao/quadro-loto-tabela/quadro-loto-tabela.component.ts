import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiaSemana } from '../../../../utils/manutencao-regras';
import { SegmentoLoto, resumoConflitos, rotuloSegmento, segmentosDaLinha } from '../../../../utils/quadro-loto-layout';

export interface QuadroLotoItem {
  status: string;
  descricao: string;
  tecnicos: string[];
  numeroOs: string | null;
}

export interface QuadroLotoLinha {
  equipamento: string;
  dias: { data: string; itens: QuadroLotoItem[]; conflito: boolean }[];
  temConflito: boolean;
  separadorAntes: boolean;
}

export interface QuadroLotoCelulaClick {
  chave: string;
  itens: QuadroLotoItem[];
  event: MouseEvent;
}

type FiltroLoto = 'todos' | 'conflitos' | 'LOTO' | 'FUNCIONANDO' | 'DISPONÍVEL';

// Cores fortes + rótulo escrito (LOTO/FUNC/DISP): antes eram quadradinhos pastel de
// 20 px numa coluna de ~115 px, só cor — vermelho × verde não serve pra daltônico.
const COR_STATUS: Record<string, string> = {
  LOTO: 'bg-red-600 text-white',
  FUNCIONANDO: 'bg-green-600 text-white',
  'DISPONÍVEL': 'bg-violet-600 text-white',
};
const COR_CONFLITO = 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-400';

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Quadro de bloqueios (LOTO) — usado pela semana única e por cada bloco do Horizonte de
// 4 semanas. Dias seguidos na mesma situação viram uma faixa (ver quadro-loto-layout),
// conflitos aparecem por extenso acima da grade, e dá pra filtrar/buscar. O popup de
// detalhe continua no host — um elemento flutuante só, compartilhado pelas instâncias.
@Component({
  selector: 'app-quadro-loto-tabela',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quadro-loto-tabela.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuadroLotoTabelaComponent {
  dias = input<DiaSemana[]>([]);
  quadroLoto = input<QuadroLotoLinha[]>([]);
  // Nome por tag (public/equipamentos-nomes.json) — opcional; sem nome mostra só a tag.
  nomes = input<Record<string, string>>({});
  @Output() celulaClick = new EventEmitter<QuadroLotoCelulaClick>();

  readonly hoje = hojeIso();
  filtro = signal<FiltroLoto>('todos');
  busca = signal('');

  // SEG–SEX dividem o espaço; SAB/DOM (quase sempre vazios) ficam estreitos.
  readonly colunas = 'grid-template-columns: minmax(7rem, 10rem) repeat(5, minmax(4.5rem, 1fr)) repeat(2, 2.75rem)';

  contagens = computed(() => {
    const linhas = this.quadroLoto();
    const tem = (l: QuadroLotoLinha, status: string) => l.dias.some(d => d.itens.some(i => i.status.toUpperCase() === status));
    return {
      todos: linhas.length,
      conflitos: linhas.filter(l => l.temConflito).length,
      LOTO: linhas.filter(l => tem(l, 'LOTO')).length,
      FUNCIONANDO: linhas.filter(l => tem(l, 'FUNCIONANDO')).length,
      'DISPONÍVEL': linhas.filter(l => tem(l, 'DISPONÍVEL')).length,
    } as Record<FiltroLoto, number>;
  });

  readonly opcoesFiltro: { id: FiltroLoto; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'conflitos', label: 'Só conflitos' },
    { id: 'LOTO', label: 'LOTO' },
    { id: 'FUNCIONANDO', label: 'Funcionando' },
    { id: 'DISPONÍVEL', label: 'Disponível' },
  ];

  linhas = computed(() => {
    const filtro = this.filtro();
    const termo = this.busca().trim().toUpperCase();
    const nomes = this.nomes();
    const filtradas = this.quadroLoto().filter(l => {
      if (filtro === 'conflitos' && !l.temConflito) return false;
      if (filtro !== 'todos' && filtro !== 'conflitos' && !l.dias.some(d => d.itens.some(i => i.status.toUpperCase() === filtro))) return false;
      if (termo && !`${l.equipamento} ${nomes[l.equipamento] ?? ''}`.toUpperCase().includes(termo)) return false;
      return true;
    });
    return filtradas.map((linha, i) => ({
      linha,
      nome: nomes[linha.equipamento] ?? null,
      segmentos: segmentosDaLinha(linha.dias),
      separadorAntes: i > 0 && filtradas[i - 1].temConflito && !linha.temConflito,
    }));
  });

  conflitos = computed(() => this.quadroLoto()
    .filter(l => l.temConflito)
    .flatMap(l => resumoConflitos(l.dias, this.dias()).map(r => ({ ...r, equipamento: l.equipamento }))));

  rotulo(seg: SegmentoLoto): string {
    return rotuloSegmento(seg);
  }

  // Detalhe curto dentro da faixa: nº da OS (ou o técnico, se não tiver OS).
  detalhe(seg: SegmentoLoto): string {
    if (seg.conflito) return '';
    if (seg.itens.length > 1) return `${seg.itens.length} OS`;
    const i = seg.itens[0];
    return i?.numeroOs ?? i?.tecnicos[0] ?? '';
  }

  corSegmento(seg: SegmentoLoto): string {
    if (seg.conflito) return COR_CONFLITO;
    return COR_STATUS[seg.itens[0]?.status.toUpperCase() ?? ''] ?? 'bg-slate-500 text-white';
  }

  tituloSegmento(seg: SegmentoLoto): string {
    const itens = seg.itens.map(i => `${i.status}${i.numeroOs ? ' · OS ' + i.numeroOs : ''}: ${i.descricao} (${i.tecnicos.join(', ')})`);
    return (seg.conflito ? 'Conflito — ' : '') + itens.join(' | ') + ' — clique pra ver detalhes';
  }

  colunaSegmento(seg: SegmentoLoto): string {
    return `${seg.inicio + 2} / span ${seg.dias}`;
  }

  onSegmentoClick(equipamento: string, seg: SegmentoLoto, event: MouseEvent): void {
    this.celulaClick.emit({ chave: `${equipamento}:${seg.datas[0]}`, itens: seg.itens, event });
  }
}
