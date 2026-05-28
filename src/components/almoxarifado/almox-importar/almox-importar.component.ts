import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlmoxarifadoService, UltimaImportacao } from '../../../services/almoxarifado.service';
import { NotificationService } from '../../../services/toast.service';
import { AuditLogService } from '../../../services/audit-log.service';
import { AuthService } from '../../../services/auth.service';

interface FileState {
  file: File | null;
  name: string;
  loading: boolean;
  done: boolean;
  error: string;
  registros: number;
}

function initState(): FileState {
  return { file: null, name: '', loading: false, done: false, error: '', registros: 0 };
}

@Component({
  selector: 'app-almox-importar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './almox-importar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlmoxImportarComponent implements OnInit {
  mov  = signal<FileState>(initState());
  sas  = signal<FileState>(initState());
  ary  = signal<FileState>(initState());
  ultimas = signal<UltimaImportacao[]>([]);

  constructor(
    private almoxService: AlmoxarifadoService,
    private toast: NotificationService,
    private auditLog: AuditLogService,
    private authService: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    const data = await this.almoxService.getUltimasImportacoes();
    this.ultimas.set(data);
  }

  onFileSelected(tipo: 'mov' | 'sas' | 'ary', event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    const update = { file, name: file.name, loading: false, done: false, error: '', registros: 0 };
    if (tipo === 'mov') this.mov.set(update);
    else if (tipo === 'sas') this.sas.set(update);
    else this.ary.set(update);
    input.value = ''; // limpa o input para permitir re-selecionar o mesmo arquivo
  }

  cancelar(tipo: 'mov' | 'sas' | 'ary'): void {
    if (tipo === 'mov') this.mov.set(initState());
    else if (tipo === 'sas') this.sas.set(initState());
    else this.ary.set(initState());
  }

  async importar(tipo: 'mov' | 'sas' | 'ary'): Promise<void> {
    const stateSignal = tipo === 'mov' ? this.mov : tipo === 'sas' ? this.sas : this.ary;
    const state = stateSignal();
    if (!state.file || state.loading) return;

    const tipoApi = tipo === 'mov' ? 'movimentacoes' : tipo === 'sas' ? 'solicitacoes' : 'status_sas';
    stateSignal.update(s => ({ ...s, loading: true, error: '', done: false }));

    try {
      const result = await this.almoxService.importarArquivo(tipoApi, state.file!);
      const registros = result.inseridos ?? result.encerradas ?? 0;
      stateSignal.update(s => ({ ...s, loading: false, done: true, registros }));
      this.toast.showSuccess(`Importado com sucesso! ${registros} registros.`);

      const user = this.authService.currentUser();
      if (user) {
        this.auditLog.log({
          user_id: user.id, user_name: user.name,
          event_type: 'material_updated',
          resource_type: 'almoxarifado',
          description: `${user.name} importou ${registros} registros de ${tipoApi}`,
          metadata: { tipo: tipoApi, arquivo: state.name, registros },
        });
      }

      const updated = await this.almoxService.getUltimasImportacoes();
      this.ultimas.set(updated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao importar.';
      stateSignal.update(s => ({ ...s, loading: false, error: msg }));
      this.toast.showError(msg);
    }
  }

  formatDate(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  tipoLabel(tipo: string): string {
    return { movimentacoes: 'Movimentações', solicitacoes: 'Solicitações (SAs)', status_sas: 'Status das SAs' }[tipo] ?? tipo;
  }
}
