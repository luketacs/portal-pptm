import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoryService } from '../../../services/history.service';
import { AuthService } from '../../../services/auth.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-request-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './request-history.component.html',
  styleUrls: ['./request-history.component.css']
})
export class RequestHistoryComponent implements OnInit, OnDestroy {
  @Input() requestId!: string;

  newComment = '';
  activeTab: 'history' | 'comments' = 'history';

  constructor(
    public historyService: HistoryService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    if (this.requestId) {
      this.loadData();
    }
  }

  ngOnDestroy(): void {
    this.historyService.clearHistory();
  }

  async loadData(): Promise<void> {
    try {
      await Promise.all([
        this.historyService.loadHistory(this.requestId),
        this.historyService.loadComments(this.requestId)
      ]);
    } catch (error) {
      console.error('Error loading history/comments:', error);
    }
  }

  async addComment(): Promise<void> {
    if (!this.newComment.trim()) return;

    const user = this.authService.currentUser();
    if (!user) return;

    try {
      await this.historyService.addComment(this.requestId, user.id, this.newComment.trim());
      this.newComment = '';
    } catch (error) {
      console.error('Error adding comment:', error);
      alert('Erro ao adicionar comentário');
    }
  }

  getActionLabel(action: string): string {
    const labels: Record<string, string> = {
      'created': 'Solicitação criada',
      'status_changed': 'Status alterado',
      'updated': 'Atualizado',
      'approved': 'Aprovado',
      'rejected': 'Rejeitado'
    };
    return labels[action] || action;
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      'pending': 'Pendente',
      'approved_manager': 'Aprovado pelo Gerente',
      'rejected_manager': 'Rejeitado pelo Gerente',
      'approved_director': 'Aprovado pela Diretoria',
      'rejected_director': 'Rejeitado pela Diretoria',
      'in_purchase': 'Em Compra',
      'purchased': 'Comprado',
      'delivered': 'Entregue',
      'cancelled': 'Cancelado'
    };
    return labels[status] || status;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
