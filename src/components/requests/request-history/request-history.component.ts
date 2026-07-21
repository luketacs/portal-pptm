import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HistoryService } from '../../../services/history.service';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/toast.service';
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

  constructor(
    public historyService: HistoryService,
    private authService: AuthService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    if (this.requestId) {
      this.historyService.loadComments(this.requestId).catch(error => {
        console.error('Error loading comments:', error);
      });
    }
  }

  ngOnDestroy(): void {
    this.historyService.clearHistory();
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
      this.notificationService.showError('Erro ao adicionar comentário.');
    }
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
