import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MecanicaVibracaoService } from '../../../services/mecanica-vibracao.service';
import { NotificationService } from '../../../services/notification.service';
import { Fundacao, Grandeza, GrupoIso, PontoMedicao, SalvarPonto } from '../../../models/mecanica-vibracao.model';
import { FUNDACAO_LABEL, GRANDEZAS, GRANDEZA_LABEL, GRUPO_ISO_LABEL, LIMITES_ISO, UNIDADE_PADRAO, grandezaDoNome } from '../../../utils/mecanica-vibracao';
import { formatarNumero, lerNumero } from '../../../utils/eletrica-ensaio';

interface PontoForm {
  id: string | null;
  nome: string;
  descricao: string;
  grandeza: Grandeza;
  unidade: string;
  alerta: string;
  perigo: string;
  rolamento: string;
  bpfo: string;
  bpfi: string;
  bsf: string;
  ftf: string;
  aberto: boolean; // linha do rolamento visível
}

const txt = (v: number | null | undefined, casas = 3) => (v === null || v === undefined ? '' : formatarNumero(v, casas));

const pontoVazio = (grandeza: Grandeza = 'envelope'): PontoForm => ({
  id: null, nome: '', descricao: '', grandeza, unidade: UNIDADE_PADRAO[grandeza], alerta: '', perigo: '',
  rolamento: '', bpfo: '', bpfi: '', bsf: '', ftf: '', aberto: false,
});

const paraForm = (p: PontoMedicao): PontoForm => ({
  id: p.id, nome: p.nome, descricao: p.descricao ?? '', grandeza: p.grandeza, unidade: p.unidade,
  alerta: txt(p.alarmeAlerta), perigo: txt(p.alarmePerigo), rolamento: p.rolamento ?? '',
  bpfo: txt(p.fatores.bpfo, 4), bpfi: txt(p.fatores.bpfi, 4), bsf: txt(p.fatores.bsf, 4), ftf: txt(p.fatores.ftf, 4),
  aberto: !!(p.rolamento || p.fatores.bpfo || p.fatores.bpfi || p.fatores.bsf || p.fatores.ftf),
});

// Cadastro (e edição) do equipamento e dos pontos da rota de vibração. Nome e alarmes de
// cada ponto iguais aos do software da SKF.
@Component({
  selector: 'app-vibracao-equipamento-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './vibracao-equipamento-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VibracaoEquipamentoFormComponent implements OnInit, OnDestroy {
  readonly grandezas = GRANDEZAS;
  readonly grandezaLabel = GRANDEZA_LABEL;
  readonly grupoLabel = GRUPO_ISO_LABEL;
  readonly fundacaoLabel = FUNDACAO_LABEL;
  readonly grupos = ['1', '2', '3', '4'] as const;

  id: string | null = null;
  carregando = signal(true);
  erroFatal = signal('');
  podeLancar = this.service.podeLancar;

  tag = signal('');
  descricao = signal('');
  area = signal('');
  tipoMaquina = signal('');
  fabricante = signal('');
  modelo = signal('');
  potenciaKw = signal('');
  rotacaoRpm = signal('');
  grupoIso = signal<GrupoIso | ''>('');
  fundacao = signal<Fundacao | ''>('');
  observacoes = signal('');
  pontos = signal<PontoForm[]>([pontoVazio()]);
  // Desenho do conjunto com os pontos de coleta: URL já salva ou arquivo novo (sobe ao salvar).
  desenhoUrl = signal<string | null>(null);
  desenhoArquivo = signal<File | null>(null);
  desenhoPreview = signal<string | null>(null);

  colando = signal(false);
  textoColado = signal('');
  grandezaColada = signal<Grandeza>('envelope');

  isSubmitting = signal(false);
  errorMessage = signal('');

  // Sugestão pelo porte (ISO 20816-3): acima de 300 kW = grupo 1; 15 a 300 kW = grupo 2.
  grupoSugerido = computed<GrupoIso | null>(() => {
    const kw = lerNumero(this.potenciaKw());
    if (kw === null) return null;
    return kw > 300 ? '1' : kw >= 15 ? '2' : null;
  });

  limitesIso = computed(() => {
    const g = this.grupoIso();
    const f = this.fundacao();
    return g && f ? LIMITES_ISO[g][f] : null;
  });

  pendencias = computed(() => {
    const p: string[] = [];
    if (!this.tag().trim()) p.push('Informe a TAG.');
    const nomes = new Set<string>();
    this.pontos().forEach((x, i) => {
      const nome = x.nome.trim();
      if (!nome) { p.push(`Ponto ${i + 1}: informe o nome.`); return; }
      if (nomes.has(nome.toUpperCase())) p.push(`Ponto "${nome}" repetido.`);
      nomes.add(nome.toUpperCase());
      if (!x.unidade.trim()) p.push(`${nome}: informe a unidade.`);
      const a = lerNumero(x.alerta);
      const d = lerNumero(x.perigo);
      if (a !== null && d !== null && d <= a) p.push(`${nome}: o perigo tem que ser maior que o alerta.`);
    });
    return p;
  });

  constructor(
    private service: MecanicaVibracaoService,
    private notificationService: NotificationService,
    private router: Router,
    route: ActivatedRoute,
  ) {
    this.id = route.snapshot.paramMap.get('id');
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!this.podeLancar()) { this.erroFatal.set('Só o inspetor de vibração (ou Admin) cadastra equipamentos. Peça ao Admin para ligar a opção no seu usuário.'); return; }
      if (this.id) {
        const [e, pontos] = await Promise.all([this.service.buscarEquipamento(this.id), this.service.pontosDo(this.id)]);
        if (!e) { this.erroFatal.set('Equipamento não encontrado.'); return; }
        this.tag.set(e.tag);
        this.descricao.set(e.descricao ?? '');
        this.area.set(e.area ?? '');
        this.tipoMaquina.set(e.tipoMaquina ?? '');
        this.fabricante.set(e.fabricante ?? '');
        this.modelo.set(e.modelo ?? '');
        this.potenciaKw.set(txt(e.potenciaKw, 2));
        this.rotacaoRpm.set(txt(e.rotacaoRpm, 1));
        this.grupoIso.set(e.grupoIso ?? '');
        this.fundacao.set(e.fundacao ?? '');
        this.observacoes.set(e.observacoes ?? '');
        this.desenhoUrl.set(e.desenhoUrl);
        this.pontos.set(pontos.length ? pontos.map(paraForm) : [pontoVazio()]);
      }
    } catch (err: unknown) {
      this.erroFatal.set(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      this.carregando.set(false);
    }
  }

  ngOnDestroy(): void {
    const p = this.desenhoPreview();
    if (p) URL.revokeObjectURL(p);
  }

  escolherDesenho(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { this.notificationService.showError('O desenho tem que ser uma imagem.'); return; }
    const antigo = this.desenhoPreview();
    if (antigo) URL.revokeObjectURL(antigo);
    this.desenhoArquivo.set(file);
    this.desenhoPreview.set(URL.createObjectURL(file));
  }

  removerDesenho(): void {
    const antigo = this.desenhoPreview();
    if (antigo) URL.revokeObjectURL(antigo);
    this.desenhoArquivo.set(null);
    this.desenhoPreview.set(null);
    this.desenhoUrl.set(null);
  }

  atualizarPonto(i: number, campo: keyof PontoForm, valor: string | boolean): void {
    this.pontos.update(l => l.map((p, j) => {
      if (j !== i) return p;
      const novo = { ...p, [campo]: valor };
      // Ponto novo: a grandeza e a unidade saem do nome do SKF (ME 01HV = velocidade, mm/s).
      if (campo === 'nome' && !p.id) {
        const g = grandezaDoNome(valor as string);
        if (g && g !== p.grandeza && p.unidade === UNIDADE_PADRAO[p.grandeza]) return { ...novo, grandeza: g, unidade: UNIDADE_PADRAO[g] };
      }
      // Trocou a grandeza: troca a unidade se ainda era a padrão da anterior.
      if (campo === 'grandeza' && p.unidade === UNIDADE_PADRAO[p.grandeza]) novo.unidade = UNIDADE_PADRAO[valor as Grandeza];
      return novo;
    }));
  }

  adicionarPonto(): void {
    const ultimo = this.pontos().at(-1);
    this.pontos.update(l => [...l, pontoVazio(ultimo?.grandeza)]);
  }

  removerPonto(i: number): void {
    this.pontos.update(l => l.filter((_, j) => j !== i));
  }

  moverPonto(i: number, delta: -1 | 1): void {
    this.pontos.update(l => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  }

  // Colar do Excel: uma linha por ponto, colunas Nome | Alerta | Perigo (tab ou ;).
  aplicarColagem(): void {
    const grandeza = this.grandezaColada();
    const novos = this.textoColado().split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const [nome, alerta = '', perigo = ''] = l.split(/\t|;/).map(c => c.trim());
      return { ...pontoVazio(grandezaDoNome(nome) ?? grandeza), nome, alerta, perigo };
    }).filter(p => p.nome);
    if (!novos.length) { this.notificationService.showError('Nada para colar.'); return; }
    // Linha vazia inicial some; nome que já existe atualiza os alarmes.
    this.pontos.update(l => {
      const base = l.filter(p => p.nome.trim());
      for (const n of novos) {
        const i = base.findIndex(p => p.nome.trim().toUpperCase() === n.nome.toUpperCase());
        if (i >= 0) base[i] = { ...base[i], alerta: n.alerta || base[i].alerta, perigo: n.perigo || base[i].perigo };
        else base.push(n);
      }
      return base;
    });
    this.textoColado.set('');
    this.colando.set(false);
    this.notificationService.showSuccess(`${novos.length} ponto(s) colado(s). Confira a grandeza e a unidade de cada um.`);
  }

  invalido(valor: string): boolean {
    return !!valor.trim() && lerNumero(valor) === null;
  }

  async onSubmit(): Promise<void> {
    const numeros = [this.potenciaKw(), this.rotacaoRpm(), ...this.pontos().flatMap(p => [p.alerta, p.perigo, p.bpfo, p.bpfi, p.bsf, p.ftf])];
    if (numeros.some(n => this.invalido(n))) {
      this.errorMessage.set('Há valores inválidos. Use só números (ex.: 4,5).');
      return;
    }
    if (this.pendencias().length) {
      this.errorMessage.set(this.pendencias()[0]);
      return;
    }
    this.isSubmitting.set(true);
    this.errorMessage.set('');
    try {
      const pontos: SalvarPonto[] = this.pontos().map((p, i) => ({
        id: p.id,
        nome: p.nome,
        descricao: p.descricao,
        grandeza: p.grandeza,
        unidade: p.unidade,
        alarmeAlerta: lerNumero(p.alerta),
        alarmePerigo: lerNumero(p.perigo),
        rolamento: p.rolamento,
        fatores: { bpfo: lerNumero(p.bpfo), bpfi: lerNumero(p.bpfi), bsf: lerNumero(p.bsf), ftf: lerNumero(p.ftf) },
        ordem: i + 1,
        ativo: true,
      }));
      const desenhoUrl = this.desenhoArquivo() ? await this.service.subirDesenho(this.desenhoArquivo()!) : this.desenhoUrl();
      const id = await this.service.salvarEquipamento({
        tag: this.tag(),
        descricao: this.descricao(),
        area: this.area(),
        tipoMaquina: this.tipoMaquina(),
        fabricante: this.fabricante(),
        modelo: this.modelo(),
        potenciaKw: lerNumero(this.potenciaKw()),
        rotacaoRpm: lerNumero(this.rotacaoRpm()),
        grupoIso: this.grupoIso() || null,
        fundacao: this.fundacao() || null,
        desenhoUrl,
        observacoes: this.observacoes(),
      }, pontos, this.id ?? undefined);
      this.notificationService.showSuccess(`Equipamento ${this.tag().trim().toUpperCase()} ${this.id ? 'atualizado' : 'cadastrado'}.`);
      await this.router.navigate(['/mecanica/vibracao/equipamentos', id]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar o equipamento.';
      this.errorMessage.set(msg);
      this.notificationService.showError(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
