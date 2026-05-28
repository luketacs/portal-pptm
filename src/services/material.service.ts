import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, timeout } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { CreateMaterialRequest, Material, MaterialApiResponse, MaterialData } from '../models/material.model';
import { SupabaseService } from './supabase.service';
import { SupabaseRestService } from './supabase-rest.service';
import { AuditLogService } from './audit-log.service';

@Injectable({ providedIn: 'root' })
export class MaterialService {
  private readonly API_BASE_URL = '/api/material-proxy';
  private readonly API_TIMEOUT_MS = 35000;
  private readonly SUPABASE_OPERATION_TIMEOUT_MS = 10000;

  constructor(
    private http: HttpClient,
    private supabaseService: SupabaseService,
    private supabaseRestService: SupabaseRestService,
    private auditLogService: AuditLogService
  ) {}

  private async supabaseRestRequest(
    method: 'POST' | 'PATCH',
    path: string,
    body: any
  ): Promise<{ data: null; error: any }> {
    if (method === 'POST') {
      return this.supabaseRestService.post(path, body, this.SUPABASE_OPERATION_TIMEOUT_MS);
    }
    return this.supabaseRestService.patch(path, body, this.SUPABASE_OPERATION_TIMEOUT_MS);
  }

  private async supabaseRestGet<T>(path: string): Promise<{ data: T | null; error: any }> {
    return this.supabaseRestService.get<T>(path, this.SUPABASE_OPERATION_TIMEOUT_MS);
  }

  getMaterialByCode(code: string): Observable<MaterialApiResponse> {
    const normalizedCode = this.normalizeMaterialCodeForApi(code);
    if (!normalizedCode) {
      return of({ success: false, data: null, error: null });
    }

    const url = `${this.API_BASE_URL}?code=${encodeURIComponent(normalizedCode)}`;

    return this.http.get<any>(url).pipe(
      timeout(this.API_TIMEOUT_MS),
      tap(response => {
        console.log('[MaterialService] Raw response from API:', response);
      }),
      map((response: any) => {
        if (response?.success && response?.data && response.data.texto_breve) {
          const materialData: MaterialData = {
            id: response.data.id,
            texto_breve: response.data.texto_breve,
            texto_completo: response.data.texto_completo,
            unidade: response.data.unidade,
            tipo: response.data.tipo,
            ncm: response.data.ncm,
            codigo_grupo: response.data.codigo_grupo,
            estoques: (response.data.estoques || []).map((s: any) => ({
              empresa: s.empresa,
              codigo: s.codigo,
              localizacao: s.localizacao,
              descricao: s.descricao,
              qAtual: String(s.qAtual),
              qEmpenhada: String(s.qEmpenhada),
            })),
          };
          return { success: true, data: materialData, error: null };
        }
        return {
          success: false,
          data: null,
          error: response?.error || 'Material não encontrado para o código informado.',
        };
      }),
      catchError(error => {
        console.error('[MaterialService] HTTP Error:', error?.message || error);
        const rawMessage = String(error?.message || '').toLowerCase();
        if (rawMessage.includes('timeout')) {
          return of({
            success: false,
            data: null,
            error: 'Tempo limite na consulta da API de saldo. Tente novamente em instantes.',
          });
        }

        const status = Number(error?.status || 0);
        if (status === 404) {
          return of({
            success: false,
            data: null,
            error: 'Material não encontrado na API de saldo para o código informado.',
          });
        }

        const statusText = status ? ` (HTTP ${status})` : '';
        const message = error?.error?.error || error?.message || 'Falha na consulta do material.';
        return of({ success: false, data: null, error: `${message}${statusText}` });
      })
    );
  }

  private normalizeMaterialCodeForApi(code: string): string {
    const raw = String(code || '').trim();
    if (!raw) return '';

    const compact = raw.replace(/\s+/g, '');
    const alphaNumericCode = compact.replace(/[^\dA-Za-z]/g, '');
    if (!alphaNumericCode) return '';

    // Se vier em formato numerico com zeros decimais (ex.: 59000010.000000), remove a parte decimal.
    const asDecimal = compact.replace(',', '.');
    if (/^\d+\.(0+)$/.test(asDecimal)) {
      return asDecimal.split('.')[0];
    }

    // Se for numero com separadores (ex.: 59.000.010), mantem apenas os digitos.
    if (/^[\d.,]+$/.test(compact)) {
      const digitsOnly = compact.replace(/[^\d]/g, '');
      if (digitsOnly.length > 0) {
        return digitsOnly;
      }
    }

    return alphaNumericCode;
  }

  async createMaterial(material: CreateMaterialRequest, userId: string): Promise<{ data: Material | null; error: any }> {
    try {
      if (!material.descricao_detalhada || material.descricao_detalhada.trim() === '') {
        return { data: null, error: { message: 'Descrição detalhada é obrigatória' } };
      }

      if (material.estoque_seguranca && !material.qtd_estoque_seguranca) {
        return { data: null, error: { message: 'Quantidade de estoque de segurança é obrigatória quando estoque de segurança está habilitado' } };
      }

      if (!material.estoque_seguranca && material.qtd_estoque_seguranca) {
        material.qtd_estoque_seguranca = null;
      }

      if (material.ncm && !/^\d{8}$/.test(material.ncm)) {
        return { data: null, error: { message: 'NCM deve conter exatamente 8 dígitos numéricos' } };
      }

      if (material.codigo === '') {
        material.codigo = null;
      }

      const insertData = {
        ...material,
        status: 'pendente',
        created_by: userId,
      };

      const { error } = await this.supabaseRestRequest('POST', 'materials', [insertData]);

      if (error) {
        if (error.code === '23505' && String(error.message || '').includes('codigo')) {
          return { data: null, error: { message: 'Já existe um material com este código' } };
        }
        return { data: null, error };
      }

      return { data: null, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async getAllMaterials(): Promise<{ data: Material[] | null; error: any }> {
    try {
      const { data: materials, error: materialsError } = await this.supabaseRestGet<Material[]>(
        'materials?select=*&order=created_at.desc'
      );

      if (materialsError) {
        return { data: null, error: materialsError };
      }

      if (!materials || materials.length === 0) {
        return { data: [], error: null };
      }

      const userIds = [...new Set(materials.map(m => m.created_by).filter(Boolean))];
      if (userIds.length === 0) {
        return {
          data: materials.map(m => ({ ...m, created_by_name: 'Desconhecido' })),
          error: null,
        };
      }

      const { data: users } = await this.supabaseRestGet<Array<{ id: string; name: string }>>(
        `profiles?select=id,name&id=in.(${userIds.join(',')})`
      );

      const usersMap = new Map((users || []).map(u => [u.id, u.name]));
      const materialsWithCreator = materials.map(material => ({
        ...material,
        created_by_name: usersMap.get(material.created_by || '') || 'Desconhecido',
      }));

      return { data: materialsWithCreator, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async getMaterialById(id: string): Promise<{ data: Material | null; error: any }> {
    try {
      const { data, error } = await this.supabaseRestGet<Material[]>(
        `materials?select=*&id=eq.${encodeURIComponent(id)}`
      );

      if (error) {
        return { data: null, error };
      }

      return { data: data && data.length > 0 ? data[0] : null, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async getMaterialByCodigo(codigo: string): Promise<{ data: Material | null; error: any }> {
    try {
      const { data, error } = await this.supabaseService.client
        .from('materials')
        .select('*')
        .eq('codigo', codigo)
        .maybeSingle();

      if (error) {
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async updateMaterial(id: string, updates: Partial<CreateMaterialRequest>, updatedBy?: string): Promise<{ data: Material | null; error: any }> {
    try {
      const { data: originalMaterial } = await this.getMaterialById(id);
      const codeChanged = updates.codigo !== undefined && originalMaterial?.codigo !== updates.codigo;

      if (updates.descricao_detalhada !== undefined) {
        if (!updates.descricao_detalhada || updates.descricao_detalhada.trim() === '') {
          return { data: null, error: { message: 'Descrição detalhada é obrigatória' } };
        }
      }

      if (updates.estoque_seguranca && !updates.qtd_estoque_seguranca) {
        return { data: null, error: { message: 'Quantidade de estoque de segurança é obrigatória quando estoque de segurança está habilitado' } };
      }

      if (updates.estoque_seguranca === false) {
        updates.qtd_estoque_seguranca = null;
      }

      if (updates.ncm && !/^\d{8}$/.test(updates.ncm)) {
        return { data: null, error: { message: 'NCM deve conter exatamente 8 dígitos numéricos' } };
      }

      const { error } = await this.supabaseRestRequest(
        'PATCH',
        `materials?id=eq.${encodeURIComponent(id)}`,
        updates
      );

      if (error) {
        if (error.code === '23505' && String(error.message || '').includes('codigo')) {
          return { data: null, error: { message: 'Já existe um material com este código' } };
        }
        return { data: null, error };
      }

      if (originalMaterial && updatedBy) {
        const { data: updaterProfile } = await this.supabaseService.client
          .from('profiles')
          .select('name')
          .eq('id', updatedBy)
          .single();

        const updaterName = updaterProfile?.name || 'Administrador';

        if (codeChanged && originalMaterial.created_by) {
          await this.notifyMaterialCodeUpdated(
            id,
            originalMaterial.created_by,
            originalMaterial.descricao_breve,
            updaterName,
            updates.codigo || null
          );
        }

        this.auditLogService.log({
          user_id: updatedBy,
          user_name: updaterName,
          event_type: 'material_updated',
          resource_type: 'material',
          resource_id: id,
          description: `${updaterName} editou o material "${originalMaterial.descricao_breve}"`,
          metadata: { material_description: originalMaterial.descricao_breve, code_changed: codeChanged },
        });
      }

      return { data: null, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async updateMaterialStatus(
    id: string,
    status: 'pendente' | 'liberado',
    adminInfo?: { id: string; name: string }
  ): Promise<{ data: Material | null; error: any }> {
    try {
      const { data: material } = adminInfo ? await this.getMaterialById(id) : { data: null };

      const { error } = await this.supabaseRestRequest(
        'PATCH',
        `materials?id=eq.${encodeURIComponent(id)}`,
        { status }
      );

      if (error) {
        return { data: null, error };
      }

      if (adminInfo && material?.created_by && material.created_by !== adminInfo.id) {
        await this.notifyMaterialStatusChanged(id, material.created_by, material.descricao_breve, status, adminInfo.name);

        // E-mail: disparado via botão no componente (mailto: abre o Outlook)
      }

      if (adminInfo && material) {
        this.auditLogService.log({
          user_id: adminInfo.id,
          user_name: adminInfo.name,
          event_type: 'material_status_changed',
          resource_type: 'material',
          resource_id: id,
          description: `${adminInfo.name} alterou status de "${material.descricao_breve}" para ${status}`,
          metadata: { material_description: material.descricao_breve, new_status: status },
        });
      }

      return { data: null, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async deleteMaterial(id: string, adminInfo?: { id: string; name: string }): Promise<{ success: boolean; error: any }> {
    try {
      const { data: material } = adminInfo ? await this.getMaterialById(id) : { data: null };

      const { error } = await this.supabaseService.client
        .from('materials')
        .delete()
        .eq('id', id);

      if (error) {
        if (error.code === 'PGRST301' || String(error.message || '').includes('permission')) {
          return {
            success: false,
            error: { message: 'Você não tem permissão para excluir este material. Apenas administradores podem excluir.' },
          };
        }

        return { success: false, error };
      }

      if (adminInfo && material?.created_by && material.created_by !== adminInfo.id) {
        await this.notifyMaterialDeleted(id, material.created_by, material.descricao_breve, adminInfo.name);
      }

      if (adminInfo && material) {
        this.auditLogService.log({
          user_id: adminInfo.id,
          user_name: adminInfo.name,
          event_type: 'material_deleted',
          resource_type: 'material',
          resource_id: id,
          description: `${adminInfo.name} excluiu o material "${material.descricao_breve}"`,
          metadata: { material_description: material.descricao_breve, material_code: material.codigo },
        });
      }

      return { success: true, error: null };
    } catch (err) {
      return { success: false, error: err };
    }
  }

  private async createNotificationForMaterialCreator(
    materialId: string,
    creatorId: string,
    materialDescription: string,
    title: string,
    message: string,
    type: 'material_created' | 'material_update' | 'material_status_change' | 'material_deleted',
    updatedBy?: string,
    materialCode?: string | null
  ): Promise<void> {
    try {
      const { error } = await this.supabaseService.client
        .from('notifications')
        .insert({
          user_id: creatorId,
          material_id: materialId,
          type,
          title,
          message,
          is_read: false,
          metadata: {
            material_id: materialId,
            material_description: materialDescription,
            material_code: materialCode,
            updated_by: updatedBy,
          },
        });

      if (error) {
        console.error('[MaterialService] Error creating notification:', error);
      }
    } catch (error) {
      console.error('[MaterialService] Exception creating notification:', error);
    }
  }

  async notifyMaterialCreated(materialId: string, creatorId: string, materialDescription: string): Promise<void> {
    await this.createNotificationForMaterialCreator(
      materialId,
      creatorId,
      materialDescription,
      'Material Cadastrado',
      `Seu material "${materialDescription}" foi cadastrado com sucesso.`,
      'material_created'
    );
  }

  async notifyMaterialCodeUpdated(
    materialId: string,
    creatorId: string,
    materialDescription: string,
    updatedBy: string,
    newCode: string | null
  ): Promise<void> {
    const codeMessage = newCode
      ? `O código "${newCode}" foi adicionado ao material "${materialDescription}".`
      : `O código foi removido do material "${materialDescription}".`;

    await this.createNotificationForMaterialCreator(
      materialId,
      creatorId,
      materialDescription,
      'Código do Material Atualizado',
      codeMessage,
      'material_update',
      updatedBy,
      newCode
    );
  }

  // ─── Storage: fotos e datasheets ───────────────────────────────────────────

  async uploadMaterialPhoto(file: File, pathPrefix: string): Promise<string | null> {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      // Nome único por upload → sempre INSERT, sem precisar de política UPDATE
      const uid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString();
      const path = `${pathPrefix}/${uid}.${ext}`;

      const { error } = await this.supabaseService.client.storage
        .from('material-photos')
        .upload(path, file, { contentType: file.type });

      if (error) {
        console.error('[MaterialService] Photo upload error:', error.message);
        return null;
      }

      const { data } = this.supabaseService.client.storage
        .from('material-photos')
        .getPublicUrl(path);

      return data.publicUrl;
    } catch (err) {
      console.error('[MaterialService] Photo upload exception:', err);
      return null;
    }
  }

  async uploadMaterialDatasheet(file: File, pathPrefix: string): Promise<string | null> {
    try {
      const uid = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString();
      const path = `${pathPrefix}/${uid}.pdf`;

      const { error } = await this.supabaseService.client.storage
        .from('material-datasheets')
        .upload(path, file, { contentType: 'application/pdf' });

      if (error) {
        console.error('[MaterialService] Datasheet upload error:', error.message);
        return null;
      }

      const { data } = this.supabaseService.client.storage
        .from('material-datasheets')
        .getPublicUrl(path);

      return data.publicUrl;
    } catch (err) {
      console.error('[MaterialService] Datasheet upload exception:', err);
      return null;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  async notifyMaterialStatusChanged(
    materialId: string,
    creatorId: string,
    materialDescription: string,
    newStatus: string,
    updatedBy: string
  ): Promise<void> {
    const isLiberado = newStatus === 'liberado';
    const title = isLiberado ? 'Material Liberado!' : 'Status do Material Atualizado';
    const message = isLiberado
      ? `Seu material "${materialDescription}" foi LIBERADO por ${updatedBy} e já está disponível para uso em novas solicitações.`
      : `O material "${materialDescription}" foi alterado para PENDENTE por ${updatedBy}.`;

    await this.createNotificationForMaterialCreator(
      materialId,
      creatorId,
      materialDescription,
      title,
      message,
      'material_status_change',
      updatedBy
    );
  }

  async notifyMaterialDeleted(
    materialId: string,
    creatorId: string,
    materialDescription: string,
    deletedBy: string
  ): Promise<void> {
    await this.createNotificationForMaterialCreator(
      materialId,
      creatorId,
      materialDescription,
      'Material Excluído',
      `O material "${materialDescription}" foi excluído por ${deletedBy}.`,
      'material_deleted',
      deletedBy
    );
  }
}

