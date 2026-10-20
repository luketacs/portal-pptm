import { ChangeDetectionStrategy, Component, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { EletricaReparoService } from '../../../services/eletrica-reparo.service';
import { NotificationService } from '../../../services/notification.service';
import { AuthService } from '../../../services/auth.service';
import { ReparoDefeito, ReparoGarantia } from '../../../models/eletrica-reparo.model';
import {
  REPARO_ENDERECO, REPARO_FOTOS_PADRAO, REPARO_SERVICO_PADRAO, REPARO_VERIFICACOES_PADRAO, numeroReparo,
} from '../../../utils/eletrica-reparo';

interface FotoForm {
  legenda: string;
  file: File | null;
  preview: string | null;
}

const defeitoVazio = (): ReparoDefeito => ({ titulo: '', sintoma: '', evolucao: '', situacaoAtual: '', causaProvavel: '' });

// Formulário do "Relatório de Falha para Reparo Externo" — mesmas 8 seções do Word que a
// Elétrica usava. Qualquer usuário logado abre; o supervisor de elétrica é avisado no Teams.
@Component({
  selector: 'app-reparo-externo-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reparo-externo-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReparoExternoFormComponent implements OnDestroy {
  readonly verificacoesPadrao = REPARO_VERIFICACOES_PADRAO;
  readonly endereco = REPARO_ENDERECO;

  // 1. Identificação
  equipamento = signal('');
  fabricanteModelo = signal('');
  numeroSerie = signal('');
  tagSap = signal('');
  localizacao = signal('');
  tempoOperacao = signal('');
  // 2. Resumo
  resumo = signal('');
  // 3. Defeitos
  defeitos = signal<ReparoDefeito[]>([defeitoVazio()]);
  // 4. Verificações
  verificacoesMarcadas = signal<string[]>([]);
  outraVerificacao = signal('');
  verificacaoResultado = signal('');
  // 5. Histórico
  dataInicioSintomas = signal('');
  dataFalhaTotal = signal('');
  intervencoesAnteriores = signal('');
  garantia = signal<ReparoGarantia | ''>('');
  // 6. Serviço
  servicoSolicitado = signal(REPARO_SERVICO_PADRAO);
  // 7. Contato (pré-preenchido com o perfil)
  contatoNome = signal('');
  contatoTelefone = signal('');
  contatoEmail = signal('');
  // 8. Fotos
  fotos = signal<FotoForm[]>(REPARO_FOTOS_PADRAO.map(legenda => ({ legenda, file: null, preview: null })));

  isSubmitting = signal(false);
  errorMessage = signal('');
  responsavel = computed(() => this.authService.currentUser()?.name ?? '');
  hoje = new Date();

  constructor(
    private reparoService: EletricaReparoService,
    private notificationService: NotificationService,
    private authService: AuthService,
    private router: Router,
  ) {
    const u = this.authService.currentUser();
    this.contatoNome.set(u?.name ?? '');
    this.contatoEmail.set(u?.email ?? '');
  }

  ngOnDestroy(): void {
    this.fotos().forEach(f => f.preview && URL.revokeObjectURL(f.preview));
  }

  // ── Defeitos ──
  adicionarDefeito(): void {
    this.defeitos.update(l => [...l, defeitoVazio()]);
  }

  removerDefeito(i: number): void {
    this.defeitos.update(l => l.filter((_, j) => j !== i));
  }

  atualizarDefeito(i: number, campo: keyof ReparoDefeito, valor: string): void {
    this.defeitos.update(l => l.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)));
  }

  // ── Verificações ──
  alternarVerificacao(v: string, marcado: boolean): void {
    this.verificacoesMarcadas.update(l => (marcado ? [...l, v] : l.filter(x => x !== v)));
  }

  // ── Fotos ──
  selecionarFoto(i: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.errorMessage.set('As fotos precisam ser imagens (JPG, PNG ou WEBP).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      this.errorMessage.set('Foto muito grande (máx. 25 MB).');
      return;
    }
    this.errorMessage.set('');
    this.fotos.update(l => l.map((f, j) => {
      if (j !== i) return f;
      if (f.preview) URL.revokeObjectURL(f.preview);
      return { ...f, file, preview: URL.createObjectURL(file) };
    }));
  }

  removerFoto(i: number): void {
    this.fotos.update(l => {
      const f = l[i];
      if (f.preview) URL.revokeObjectURL(f.preview);
      // As 6 vistas padrão ficam com o espaço vazio; foto extra sai da lista.
      return i < REPARO_FOTOS_PADRAO.length
        ? l.map((x, j) => (j === i ? { ...x, file: null, preview: null } : x))
        : l.filter((_, j) => j !== i);
    });
  }

  adicionarFotoExtra(): void {
    this.fotos.update(l => [...l, { legenda: '', file: null, preview: null }]);
  }

  atualizarLegenda(i: number, legenda: string): void {
    this.fotos.update(l => l.map((f, j) => (j === i ? { ...f, legenda } : f)));
  }

  canSubmit(): boolean {
    return !!this.equipamento().trim() && !!this.resumo().trim() && !!this.servicoSolicitado().trim()
      && this.defeitos().every(d => !!d.titulo.trim()) && !this.isSubmitting();
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) {
      this.errorMessage.set('Preencha equipamento, resumo, o título de cada defeito e o serviço solicitado.');
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    const outra = this.outraVerificacao().trim();
    try {
      const { id, numero } = await this.reparoService.criar(
        {
          equipamento: this.equipamento(),
          fabricanteModelo: this.fabricanteModelo(),
          numeroSerie: this.numeroSerie(),
          tagSap: this.tagSap(),
          localizacao: this.localizacao(),
          tempoOperacao: this.tempoOperacao(),
          resumo: this.resumo(),
          defeitos: this.defeitos().map(d => ({
            titulo: d.titulo.trim(), sintoma: d.sintoma.trim(), evolucao: d.evolucao.trim(),
            situacaoAtual: d.situacaoAtual.trim(), causaProvavel: d.causaProvavel.trim(),
          })),
          verificacoes: [...this.verificacoesMarcadas(), ...(outra ? [outra] : [])],
          verificacaoResultado: this.verificacaoResultado(),
          dataInicioSintomas: this.dataInicioSintomas() || null,
          dataFalhaTotal: this.dataFalhaTotal() || null,
          intervencoesAnteriores: this.intervencoesAnteriores(),
          garantia: this.garantia() || null,
          servicoSolicitado: this.servicoSolicitado(),
          contatoNome: this.contatoNome(),
          contatoTelefone: this.contatoTelefone(),
          contatoEmail: this.contatoEmail(),
        },
        this.fotos().filter(f => f.file).map(f => ({ file: f.file!, legenda: f.legenda })),
      );
      this.notificationService.showSuccess(`Solicitação ${numeroReparo(numero)} enviada! O supervisor de elétrica foi avisado.`);
      await this.router.navigate(['/eletrica/reparos', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar solicitação.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
