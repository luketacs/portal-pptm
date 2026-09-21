import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ManutencaoProgramacaoService } from '../../../../services/manutencao-programacao.service';
import { ApontamentosService } from '../../../../services/apontamentos.service';
import { NotificationService } from '../../../../services/notification.service';
import { ManutencaoArea, ManutencaoOrdem } from '../../../../models/manutencao-programacao.model';
import { DiaSemana, bloqueioDoTecnico, diaMesPadded, diasDaSemana, ordemDuplicada, tecnicosPorArea } from '../../../../utils/manutencao-regras';

// Modal "+Apoio" (duplica uma OS pra um segundo técnico) — extraído de
// manutencao-programacao pra reduzir o tamanho do componente host. Cada técnico
// (principal e apoio) fica com seu próprio lançamento, editável separadamente (dias,
// duração, status) — assim a OS aparece na agenda e na capacidade dos dois, sem um
// único registro compartilhado entre eles. `semanaFiltro` chega como @Input clássico
// (não signal), por isso tecnicosParaApoio()/diasDaSemanaAtual() são métodos simples.
@Component({
  selector: 'app-modal-apoio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './modal-apoio.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalApoioComponent {
  @Input() semanaFiltro = '';

  aberto = signal(false);
  origem = signal<ManutencaoOrdem | null>(null);
  tecnicoNome = signal('');
  tecnicoMatricula = signal('');
  // Começa vazio — o usuário marca só o(s) dia(s) em que realmente precisa do apoio
  // (ex.: OS de segunda a terça, apoio só na terça). Começar com tudo marcado gerava
  // engano: quem só clicava no dia que precisava (sem notar que os outros já vinham
  // marcados) acabava confirmando o apoio nos dias errados também.
  diasSelecionados = signal<string[]>([]);
  isProcessando = signal(false);

  constructor(
    private manutencaoService: ManutencaoProgramacaoService,
    private apontamentosService: ApontamentosService,
    private notificationService: NotificationService,
  ) {}

  private tecnicosPorArea(area: ManutencaoArea): { nome: string; matricula: string | null }[] {
    return tecnicosPorArea(area, this.apontamentosService.colaboradores(), this.manutencaoService.equipesApoio(), this.semanaFiltro);
  }

  diasDaSemanaAtual(): DiaSemana[] {
    return diasDaSemana(this.semanaFiltro);
  }

  readonly diaMesPadded = diaMesPadded;

  tecnicosParaApoio(): { nome: string; matricula: string | null }[] {
    const origem = this.origem();
    if (!origem) return [];
    return this.tecnicosPorArea(origem.area).filter(t => t.nome !== origem.tecnicoNome);
  }

  // Dias selecionáveis pro apoio — só os dias em que a OS de origem já está prevista
  // (não faz sentido apoiar num dia em que a atividade nem vai rodar).
  apoioDiasDisponiveis(): DiaSemana[] {
    const origem = this.origem();
    if (!origem) return [];
    return this.diasDaSemanaAtual().filter(d => origem.diasPrevistos.includes(d.data));
  }

  abrir(o: ManutencaoOrdem): void {
    this.origem.set(o);
    this.tecnicoNome.set('');
    this.tecnicoMatricula.set('');
    // Só pré-marca sozinho quando não há escolha real (1 dia só); com 2+ dias, começa
    // vazio pra obrigar a escolha consciente (ver comentário em diasSelecionados).
    this.diasSelecionados.set(o.diasPrevistos.length === 1 ? [...o.diasPrevistos] : []);
    this.aberto.set(true);
  }

  fechar(): void {
    this.aberto.set(false);
    this.origem.set(null);
  }

  toggleDia(dataIso: string): void {
    const atual = this.diasSelecionados();
    this.diasSelecionados.set(
      atual.includes(dataIso) ? atual.filter(d => d !== dataIso) : [...atual, dataIso].sort(),
    );
  }

  onTecnicoSelected(nome: string): void {
    this.tecnicoNome.set(nome);
    const colaborador = this.tecnicosParaApoio().find(c => c.nome === nome);
    this.tecnicoMatricula.set(colaborador?.matricula ?? '');
  }

  // Mesmo bloqueio de férias/folga do formulário principal, aplicado ao técnico de
  // apoio só nos dias efetivamente selecionados pro apoio (não a OS de origem inteira
  // — não faz sentido bloquear por um dia em que o apoio nem foi marcado). origem/
  // tecnicoNome/diasSelecionados são todos signals locais, então dá pra manter como
  // computed() com segurança (nenhum deles depende do @Input semanaFiltro).
  tecnicoBloqueio = computed<{ motivo: string } | null>(() => {
    const origem = this.origem();
    const nome = this.tecnicoNome().trim();
    const dias = this.diasSelecionados();
    if (!origem || !nome || dias.length === 0) return null;
    const bloqueio = bloqueioDoTecnico(
      this.manutencaoService.ferias(), this.manutencaoService.atestados(), this.manutencaoService.ordens(), nome, dias,
    );
    if (bloqueio) return bloqueio;
    if (origem.numeroOs && ordemDuplicada(this.manutencaoService.ordens(), origem.numeroOs, nome, dias)) {
      return { motivo: `${nome} já tem a OS ${origem.numeroOs} lançada em algum desses dias.` };
    }
    return null;
  });

  canConfirmar(): boolean {
    return !this.isProcessando() && !!this.origem() && !!this.tecnicoNome().trim()
      && this.diasSelecionados().length > 0 && !this.tecnicoBloqueio();
  }

  async confirmar(): Promise<void> {
    const origem = this.origem();
    if (!this.canConfirmar() || !origem) return;
    this.isProcessando.set(true);
    // Da perspectiva do técnico de apoio, "Recursos" é quem mais está no serviço — o
    // mandante da OS original e os outros recursos já listados, nunca ele mesmo.
    const apoioTecnico = this.tecnicoNome();
    const recursosDoApoio = [
      ...(origem.recursos ? origem.recursos.split(',').map(s => s.trim()).filter(Boolean) : []),
      origem.tecnicoNome,
    ].filter(r => r.toUpperCase() !== apoioTecnico.toUpperCase()).join(', ');
    try {
      await this.manutencaoService.criarOrdem({
        tipo: 'ordem',
        area: origem.area,
        // Copia a classificação da OS de origem — sem isso, todo apoio de uma OS de
        // Apoio nascia com categoriaIndicador em branco (categoria_indicador só é
        // auto-preenchida pelo service pra Mecânica/Elétrica, nunca pra Apoio) e caía
        // em "Não classificado" no indicador, mesmo a OS original estando classificada.
        categoriaIndicador: origem.categoriaIndicador ?? undefined,
        semanaInicio: origem.semanaInicio,
        numeroOs: origem.numeroOs ?? undefined,
        semOs: origem.semOs,
        descricao: origem.descricao,
        equipamento: origem.equipamento ?? undefined,
        recursos: recursosDoApoio || undefined,
        loto: origem.loto ?? undefined,
        areaAtuacao: origem.areaAtuacao ?? undefined,
        // Não copia a duração da OS de origem — o apoio pode estar em menos dias (ou um
        // esforço diferente) do que a atividade inteira; copiar a mesma duração inflava
        // o HH do apoio pro valor da atividade toda. Fica em branco pro técnico
        // preencher o esforço real dele (editável depois em "Editar").
        tipoServico: origem.tipoServico ?? undefined,
        tecnicoNome: this.tecnicoNome(),
        tecnicoMatricula: this.tecnicoMatricula() || undefined,
        diasPrevistos: this.diasSelecionados(),
        status: 'PEND',
        observacoes: origem.observacoes ?? undefined,
      });
      this.notificationService.showSuccess(`OS adicionada também para ${this.tecnicoNome()}.`);
      this.fechar();
    } catch (err: unknown) {
      this.notificationService.showError(err instanceof Error ? err.message : 'Erro ao adicionar apoio.');
    } finally {
      this.isProcessando.set(false);
    }
  }
}
