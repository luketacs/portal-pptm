import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { RequestComment } from '../models/history.model';
import type { CommentRow } from '../models/database.types';

@Injectable({
  providedIn: 'root'
})
export class HistoryService {
  private supabase = this.supabaseService.client;

  comments = signal<RequestComment[]>([]);
  isLoading = signal(false);

  constructor(private supabaseService: SupabaseService) {}

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

  clearHistory(): void {
    this.comments.set([]);
  }
}
