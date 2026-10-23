import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { RequestComment } from '../models/history.model';
import type { CommentRow } from '../models/database.types';
import { upsertNaLista } from '../utils/lista-local';

// Mesmo select do loadComments(), pra linha devolvida no insert já vir com o nome.
const SELECT_COMENTARIO = `
          *,
          profiles:user_id (name)
        `;

function mapComentario(c: CommentRow): RequestComment {
  return {
    id: c.id,
    request_id: c.request_id,
    user_id: c.user_id,
    comment: c.comment,
    created_at: c.created_at,
    updated_at: c.updated_at ?? '',
    user_name: c.profiles?.name ?? 'Usuário',
  };
}

// Mesma ordem do loadComments(): created_at asc.
const ordemComentarios = (a: RequestComment, b: RequestComment) =>
  new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

@Injectable({
  providedIn: 'root'
})
export class RequestCommentsService {
  private supabase = this.supabaseService.client;

  comments = signal<RequestComment[]>([]);
  isLoading = signal(false);

  constructor(private supabaseService: SupabaseService) {}

  async loadComments(requestId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabase
        .from('request_comments')
        .select(SELECT_COMENTARIO)
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const commentsWithNames = (data as CommentRow[] | null ?? []).map(mapComentario);

      this.comments.set(commentsWithNames);
    } catch (error) {
      console.error('Error loading comments:', error);
      throw error;
    } finally {
      this.isLoading.set(false);
    }
  }

  async addComment(requestId: string, userId: string, comment: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('request_comments')
      .insert({
        request_id: requestId,
        user_id: userId,
        comment: comment
      })
      .select(SELECT_COMENTARIO)
      .single();

    if (error) throw error;

    // Insert devolve o comentário (com o nome do autor); só entra na lista se ela for desta SC.
    const novo = mapComentario(data as CommentRow);
    const lista = this.comments();
    if (lista.length && lista[0].request_id !== requestId) {
      await this.loadComments(requestId);
      return;
    }
    this.comments.set(upsertNaLista(lista, novo, ordemComentarios));
  }

  clearComments(): void {
    this.comments.set([]);
  }
}
