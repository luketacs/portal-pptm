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
};

export const AUDIT_EVENT_CATEGORIES: Record<string, string[]> = {
  'Autenticação':   ['login', 'logout', 'password_change', 'password_reset'],
  'Usuários':       ['user_created', 'user_updated', 'user_deleted'],
  'Solicitações':   ['request_created', 'request_status_changed', 'request_updated', 'request_deleted'],
  'Materiais':      ['material_created', 'material_updated', 'material_status_changed', 'material_deleted'],
};

@Injectable({ providedIn: 'root' })
export class AuditLogService {
  constructor(private supabaseService: SupabaseService) {}

  log(event: AuditLogEvent): void {
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
        if (error) console.warn('[AuditLog] Falha ao registrar evento:', event.event_type, error.message);
      });
  }
}
