import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  DadosRelatorioImpresso, dataCurta, eixoMinimo, geometriaLinhas, ledeResumo, ledeTendencia, num, num2, pct, pontosSvg,
  tituloResumo, tituloTendencia,
} from '../../../utils/relatorio-impresso';

// Documento impresso do Acompanhamento de Indicadores (botão "Gerar Relatório" da tela
// autenticada e da pública). Só aparece no papel: na tela fica escondido, e no
// impresso a tela inteira some e sobra só ele. Três páginas A4 paisagem de tamanho
// fixo — resumo, equipe/horas e tendência — em vez da tela "derramada" no papel.
@Component({
  selector: 'app-relatorio-indicadores-impresso',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './relatorio-indicadores-impresso.component.html',
  styleUrl: './relatorio-indicadores-impresso.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelatorioIndicadoresImpressoComponent {
  dados = input.required<DadosRelatorioImpresso>();

  readonly num = num;
  readonly num2 = num2;
  readonly pct = pct;
  readonly pontosSvg = pontosSvg;
  readonly tituloTendencia = tituloTendencia;
  readonly totalPaginas = 3;
  // Abaixo disso a eficiência do técnico sai em vermelho na tabela de horas.
  readonly eficienciaMinima = 85;

  emitido = computed(() => dataCurta(this.dados().emitidoEm));

  titulo = computed(() => {
    const d = this.dados();
    return tituloResumo({ rotulo: d.rotulo, meta: d.meta, atendimento: d.atendimento, cumprimento: d.cumprimento });
  });

  lede = computed(() => {
    const d = this.dados();
    return ledeResumo({ meta: d.meta, atendimento: d.atendimento, cumprimento: d.cumprimento, areas: d.areas, atendimentoAno: d.ano.atendimento.percentual });
  });

  ledeTendencia = computed(() => {
    const d = this.dados();
    return ledeTendencia({ meta: d.meta, pontos: d.tendencia, areas: d.tendenciaAreas, unidade: d.unidadeTendencia });
  });

  maiorHoraEquipamento = computed(() => Math.max(1, ...this.dados().equipamentos.map(e => e.horas)));

  // Gráfico principal: as duas séries numa escala com zoom (piso em degrau redondo).
  readonly grafico = { largura: 1000, altura: 270 };
  tendencia = computed(() => {
    const d = this.dados();
    const at = d.tendencia.map(p => p.atendimento);
    const cu = d.tendencia.map(p => p.cumprimento);
    const g = geometriaLinhas({
      series: [at, cu], largura: this.grafico.largura, altura: this.grafico.altura,
      margem: { esq: 34, dir: 48, topo: 10, base: 22 }, ymin: eixoMinimo([...at, ...cu]), meta: d.meta,
    });
    const iPiorPlano = cu.reduce((pior, v, i) => (v < cu[pior] ? i : pior), 0);
    return {
      ...g,
      atendimento: g.series[0],
      cumprimento: g.series[1],
      ultimoAtendimento: at[at.length - 1],
      piorPlano: cu.length && cu[iPiorPlano] < d.meta ? { ponto: g.series[1][iPiorPlano], valor: cu[iPiorPlano] } : null,
    };
  });

  // Pequenos múltiplos por área: mesma escala 0–100 pra todas, pra comparar de verdade.
  readonly mini = { largura: 300, altura: 170 };
  tendenciaAreas = computed(() => this.dados().tendenciaAreas.map(a => {
    const g = geometriaLinhas({
      series: [a.pontos], largura: this.mini.largura, altura: this.mini.altura,
      margem: { esq: 14, dir: 14, topo: 8, base: 16 }, ymin: 0, meta: this.dados().meta,
    });
    return { nome: a.nome, ultimo: a.pontos[a.pontos.length - 1] ?? 0, linha: g.series[0], gradeY: g.gradeY, xs: g.xs, yMeta: g.yMeta };
  }));
}
