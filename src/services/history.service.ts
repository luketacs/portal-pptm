import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { RequestHistory, RequestComment } from '../models/history.model';
import type { HistoryRow, CommentRow } from '../models/database.types';

@Injectable({
  providedIn: 'root'
})
export class HistoryService {
  private supabase = this.supabaseService.client;

  history = signal<RequestHistory[]>([]);
  comments = signal<RequestComment[]>([]);
  isLoading = signal(false);

  constructor(private supabaseService: SupabaseService) {}

  async loadHistory(requestId: string): Promise<void> {
    this.isLoading.set(true);
    let forcedTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      forcedTimeout = setTimeout(() => {
        this.isLoading.set(false);
      }, 15000);
      const { data, error } = await this.supabase
        .from('request_history')
        .select(`
          *,
          profiles:user_id (name)
        `)
        .eq('request_id', requestId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const historyWithNames = (data as HistoryRow[] | null ?? []).map((h) => ({
        id: h.id,
        request_id: h.request_id,
        user_id: h.user_id,
        action: h.action as RequestHistory['action'],
        field_changed: h.field_changed ?? undefined,
        old_value: h.old_value ?? undefined,
        new_value: h.new_value ?? undefined,
        comment: h.comment ?? undefined,
        created_at: h.created_at,
        user_name: h.profiles?.name ?? 'Sistema',
      }));

      this.history.set(historyWithNames);
    } catch (error) {
      console.error('Error loading history:', error);
      throw error;
    } finally {
      clearTimeout(forcedTimeout);
      this.isLoading.set(false);
    }
  }

  async loadComments(requestId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabase
        .from('request_comments')
        .select(`
          *,
          profiles:user_id (name)
        `)
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const commentsWithNames = (data as CommentRow[] | null ?? []).map((c) => ({
        id: c.id,
        request_id: c.request_id,
        user_id: c.user_id,
        comment: c.comment,
        created_at: c.created_at,
        updated_at: c.updated_at ?? '',
        user_name: c.profiles?.name ?? 'Usuário',
      }));

      this.comments.set(commentsWithNames);
    } catch (error) {
      console.error('Error loading comments:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  async addComment(requestId: string, userId: string, comment: string): Promise<void> {
    const { error } = await this.supabase
      .from('request_comments')
      .insert({
        request_id: requestId,
        user_id: userId,
        comment: comment
      });

    if (error) throw error;

    // Recarregar comentários
    await this.loadComments(requestId);
  }

  async addHistoryEntry(
    requestId: string,
    userId: string,
    action: string,
    fieldChanged?: string,
    oldValue?: string,
    newValue?: string,
    comment?: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('request_history')
      .insert({
        request_id: requestId,
        user_id: userId,
        action,
        field_changed: fieldChanged,
        old_value: oldValue,
        new_value: newValue,
        comment
      });

    if (error) throw error;
  }

  clearHistory(): void {
    this.history.set([]);
    this.comments.set([]);
  }
}
