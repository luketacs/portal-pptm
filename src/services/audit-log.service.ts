import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface AuditLogEvent {
  user_id: string;
  user_name: string;
  event_type: string;
  resource_type?: string;
  resource_id?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

// Categorias de eventos para exibição na UI
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  login:                    'Login',
  logout:                   'Logout',
  password_change:          'Troca de senha',
  password_reset:           'Reset de senha (admin)',
  user_created:             'Usuário criado',
  user_updated:             'Usuário atualizado',
  user_deleted:             'Usuário excluído',
  request_created:          'Solicitação criada',
  request_status_changed:   'Status de solicitação alterado',
  request_updated:          'Solicitação editada',
  request_deleted:          'Solicitação excluída',
  material_created:         'Material cadastrado',
  material_updated:         'Material editado',
  material_status_changed:  'Status de material alterado',
  material_deleted:         'Material excluído',
  fundo_fixo_solicitado:    'Fundo Fixo solicitado',
  fundo_fixo_aprovado:      'Fundo Fixo aprovado',
  fundo_fixo_recusado:      'Fundo Fixo recusado',
  fundo_fixo_comprado:      'Fundo Fixo — compra registrada',
};

export const AUDIT_EVENT_CATEGORIES: Record<string, string[]> = {
  'Autenticação':   ['login', 'logout', 'password_change', 'password_reset'],
  'Usuários':       ['user_created', 'user_updated', 'user_deleted'],
  'Solicitações':   ['request_created', 'request_status_changed', 'request_updated', 'request_deleted'],
  'Materiais':      ['material_created', 'material_updated', 'material_status_changed', 'material_deleted'],
  'Fundo Fixo':     ['fundo_fixo_solicitado', 'fundo_fixo_aprovado', 'fundo_fixo_recusado', 'fundo_fixo_comprado'],
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  constructor(private supabaseService: SupabaseService) {}

  // Fire-and-forget do ponto de vista de quem chama, mas tenta algumas vezes
  // antes de desistir — uma falha transitória de rede não deve, sozinha, deixar
  // um evento de auditoria sem registro.
  log(event: AuditLogEvent): void {
    this.attempt(event, 1);
  }

  private attempt(event: AuditLogEvent, attemptNumber: number): void {
    this.supabaseService.client
      .from('audit_logs')
      .insert({
        user_id: event.user_id || null,
        user_name: event.user_name,
        event_type: event.event_type,
        resource_type: event.resource_type ?? null,
        resource_id: event.resource_id ?? null,
        description: event.description,
        metadata: event.metadata ?? null,
      })
      .then(({ error }) => {
        if (!error) return;
        if (attemptNumber < MAX_ATTEMPTS) {
          sleep(RETRY_DELAY_MS * attemptNumber).then(() => this.attempt(event, attemptNumber + 1));
          return;
        }
        console.error(
          `[AuditLog] Falha ao registrar evento após ${MAX_ATTEMPTS} tentativas:`,
          event.event_type, error.message
        );
      });
  }
}
