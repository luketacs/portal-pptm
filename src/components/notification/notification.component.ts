import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationComponent {
  constructor(public notificationService: NotificationService) {}
}