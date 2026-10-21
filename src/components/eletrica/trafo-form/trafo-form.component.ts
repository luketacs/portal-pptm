import { ChangeDetectionStrategy, Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EletricaEnsaioService } from '../../../services/eletrica-ensaio.service';
import { NotificationService } from '../../../services/notification.service';
import { ClasseIsolamento, SituacaoEquipamento } from '../../../models/eletrica-ensaio.model';
import { Ligacao, MaterialEnrolamento, MeioIsolante } from '../../../models/eletrica-trafo.model';
import { CLASSES_ISOLAMENTO, CLASSE_LABEL, SITUACOES, SITUACAO_LABEL, rotuloLocal, formatarMohm, formatarNumero, lerNumero } from '../../../utils/eletrica-ensaio';
import {
  LIGACAO_LABEL, MATERIAL_LABEL, MEIO_LABEL, formatarRelacao, irMinimoTrafoMohm, relacaoCalculada, tensaoEnsaioTrafo,
} from '../../../utils/eletrica-trafo';

interface SecundarioForm {
  nome: string;
  tensaoV: string;
  ligacao: Ligacao;
}

// Dados de placa do transformador. Ligações e tensões definem os pares da resistência
// ôhmica, as relações esperadas do TTR e o mínimo de isolamento (NETA MTS).
@Component({
  selector: 'app-trafo-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './trafo-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrafoFormComponent implements OnInit {
  readonly classes = CLASSES_ISOLAMENTO;
  readonly situacoes = SITUACOES;
  readonly situacaoLabel = SITUACAO_LABEL;
  readonly rotuloLocal = rotuloLocal;
  readonly classeLabel = CLASSE_LABEL;
  readonly ligacaoLabel = LIGACAO_LABEL;
  readonly meioLabel = MEIO_LABEL;
  readonly materialLabel = MATERIAL_LABEL;
  readonly ligacoes: Ligacao[] = ['D', 'Y'];
  readonly meios: MeioIsolante[] = ['seco', 'oleo'];
  readonly materiais: MaterialEnrolamento[] = ['cobre', 'aluminio'];

  id: string | null = null;
  carregando = signal(false);

  tag = signal('');
  descricao = signal('');
  situacao = signal<SituacaoEquipamento>('instalado');
  aplicacao = signal('');
  localInstalacao = signal('');
  fabricante = signal('');
  modelo = signal('');
  numeroSerie = signal('');
  codigoProduto = signal('');
  normaFabricacao = signal('');
  potenciaKva = signal('');
  frequenciaHz = signal('60');
  tensaoPrimaria = signal('');
  ligacaoPrimaria = signal<Ligacao>('D');
  secundarios = signal<SecundarioForm[]>([{ nome: 'X', tensaoV: '', ligacao: 'Y' }]);
  relacaoTaps = signal('');
  meioIsolante = signal<MeioIsolante>('seco');
  materialEnrolamento = signal<MaterialEnrolamento>('cobre');
  classeIsolamento = signal<ClasseIsolamento>('F');
  elevacaoTemperatura = signal('');
  refrigeracao = signal('');
  grauProtecao = signal('');
  classeAmbiental = signal('');
  massaKg = signal('');
  observacoes = signal('');

  isSubmitting = signal(false);
  errorMessage = signal('');

  // O que a norma vai cobrar desse trafo — aparece enquanto preenche.
  criterio = computed(() => {
    const vp = lerNumero(this.tensaoPrimaria());
    if (!vp || vp <= 0) return null;
    const meio = this.meioIsolante();
    const enrolamentos = [
      { nome: 'H (primário)', tensao: vp },
      ...this.secundarios().map(s => ({ nome: s.nome || '?', tensao: lerNumero(s.tensaoV) ?? 0 })),
    ].filter(e => e.tensao > 0);
    return {
      isolamento: enrolamentos.map(e => ({
        nome: e.nome,
        minimo: formatarMohm(irMinimoTrafoMohm(e.tensao, meio)),
        tensaoEnsaio: tensaoEnsaioTrafo(e.tensao),
      })),
      ttr: this.secundarios()
        .map(s => ({ s, v: lerNumero(s.tensaoV) }))
        .filter(x => x.v && x.v > 0)
        .map(x => ({
          nome: x.s.nome || '?',
          relacao: formatarRelacao(relacaoCalculada(vp, this.ligacaoPrimaria(), { nome: x.s.nome, tensaoV: x.v!, ligacao: x.s.ligacao })),
        })),
    };
  });

  constructor(
    private ensaioService: EletricaEnsaioService,
    private notificationService: NotificationService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id');
  }

  async ngOnInit(): Promise<void> {
    if (!this.id) return;
    this.carregando.set(true);
    try {
      const t = await this.ensaioService.buscarTrafo(this.id);
      if (!t) {
        this.errorMessage.set('Transformador não encontrado.');
        return;
      }
      const txt = (v: number | null) => (v === null ? '' : formatarNumero(v, 2));
      this.tag.set(t.tag);
      this.descricao.set(t.descricao ?? '');
      this.situacao.set(t.situacao);
      this.aplicacao.set(t.aplicacao ?? '');
      this.localInstalacao.set(t.localInstalacao ?? '');
      this.fabricante.set(t.fabricante ?? '');
      this.modelo.set(t.modelo ?? '');
      this.numeroSerie.set(t.numeroSerie ?? '');
      this.codigoProduto.set(t.codigoProduto ?? '');
      this.normaFabricacao.set(t.normaFabricacao ?? '');
      this.potenciaKva.set(txt(t.potenciaKva));
      this.frequenciaHz.set(txt(t.frequenciaHz));
      this.tensaoPrimaria.set(txt(t.tensaoPrimariaV));
      this.ligacaoPrimaria.set(t.ligacaoPrimaria);
      this.secundarios.set(t.secundarios.map(s => ({ nome: s.nome, tensaoV: txt(s.tensaoV), ligacao: s.ligacao })));
      this.relacaoTaps.set(t.relacaoTaps ?? '');
      this.meioIsolante.set(t.meioIsolante);
      this.materialEnrolamento.set(t.materialEnrolamento);
      this.classeIsolamento.set(t.classeIsolamento);
      this.elevacaoTemperatura.set(txt(t.elevacaoTemperaturaC));
      this.refrigeracao.set(t.refrigeracao ?? '');
      this.grauProtecao.set(t.grauProtecao ?? '');
      this.classeAmbiental.set(t.classeAmbiental ?? '');
      this.massaKg.set(txt(t.massaKg));
      this.observacoes.set(t.observacoes ?? '');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Erro ao carregar o transformador.');
    } finally {
      this.carregando.set(false);
    }
  }

  adicionarSecundario(): void {
    this.secundarios.update(l => {
      // Ao ganhar o 2º secundário, "X" vira "1X" e o novo "2X" (padrão do trafo de 12 pulsos).
      const ajustada = l.length === 1 && l[0].nome === 'X' ? [{ ...l[0], nome: '1X' }] : l;
      return [...ajustada, { nome: `${ajustada.length + 1}X`, tensaoV: ajustada[0]?.tensaoV ?? '', ligacao: 'Y' }];
    });
  }

  removerSecundario(i: number): void {
    this.secundarios.update(l => l.filter((_, j) => j !== i));
  }

  atualizarSecundario(i: number, campo: keyof SecundarioForm, valor: string): void {
    this.secundarios.update(l => l.map((s, j) => (j === i ? { ...s, [campo]: campo === 'nome' ? valor.toUpperCase() : valor } : s)));
  }

  private validarSecundarios(): string | null {
    const l = this.secundarios();
    if (!l.length) return 'Informe pelo menos um secundário.';
    const nomes = l.map(s => s.nome.trim());
    if (nomes.some(n => !/^[A-Z0-9]{1,4}$/.test(n) || n === 'H' || n === 'TE')) return 'Nome do secundário: até 4 letras/números (ex.: X, 1X, 2X), diferente de H e TE.';
    if (new Set(nomes).size !== nomes.length) return 'Os secundários precisam ter nomes diferentes.';
    if (l.some(s => !lerNumero(s.tensaoV) || lerNumero(s.tensaoV)! <= 0)) return 'Informe a tensão de cada secundário.';
    return null;
  }

  async onSubmit(): Promise<void> {
    const vp = lerNumero(this.tensaoPrimaria());
    if (!this.tag().trim() || !vp || vp <= 0) {
      this.errorMessage.set('Preencha a TAG e a tensão do primário.');
      return;
    }
    const erroSec = this.validarSecundarios();
    if (erroSec) {
      this.errorMessage.set(erroSec);
      return;
    }
    const brutos = [this.potenciaKva(), this.frequenciaHz(), this.elevacaoTemperatura(), this.massaKg()];
    if (brutos.some(b => b.trim() && lerNumero(b) === null)) {
      this.errorMessage.set('Algum campo numérico tem valor inválido (use só números, ex.: 2.500).');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const id = await this.ensaioService.salvarTrafo({
        tag: this.tag(),
        descricao: this.descricao(),
        situacao: this.situacao(),
        aplicacao: this.aplicacao(),
        localInstalacao: this.localInstalacao(),
        fabricante: this.fabricante(),
        modelo: this.modelo(),
        numeroSerie: this.numeroSerie(),
        codigoProduto: this.codigoProduto(),
        normaFabricacao: this.normaFabricacao(),
        potenciaKva: lerNumero(this.potenciaKva()),
        tensaoPrimariaV: vp,
        ligacaoPrimaria: this.ligacaoPrimaria(),
        secundarios: this.secundarios().map(s => ({ nome: s.nome.trim(), tensaoV: lerNumero(s.tensaoV)!, ligacao: s.ligacao })),
        frequenciaHz: lerNumero(this.frequenciaHz()),
        relacaoTaps: this.relacaoTaps(),
        meioIsolante: this.meioIsolante(),
        materialEnrolamento: this.materialEnrolamento(),
        classeIsolamento: this.classeIsolamento(),
        elevacaoTemperaturaC: lerNumero(this.elevacaoTemperatura()),
        refrigeracao: this.refrigeracao(),
        grauProtecao: this.grauProtecao(),
        classeAmbiental: this.classeAmbiental(),
        massaKg: lerNumero(this.massaKg()),
        observacoes: this.observacoes(),
      }, this.id ?? undefined);
      this.notificationService.showSuccess(this.id ? 'Transformador atualizado.' : `Transformador ${this.tag().trim().toUpperCase()} cadastrado.`);
      await this.router.navigate(['/eletrica/ensaios/trafos', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar o transformador.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
