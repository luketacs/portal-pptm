import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  email = signal('');
  password = signal('');
  error = signal('');
  isLoggingIn = signal(false);
  consentGiven = signal(false);
  private readonly LOGIN_UI_TIMEOUT_MS = 15000;

  constructor(
    public authService: AuthService,
    private router: Router,
    private notificationService: NotificationService
  ) {}

  async onLogin() {
    this.error.set('');

    if (!this.email() || !this.password()) {
      const message = 'Por favor, preencha o e-mail e a senha.';
      this.error.set(message);
      this.notificationService.showError(message);
      return;
    }

    if (!this.consentGiven()) {
      const message = 'Você deve aceitar a Política de Privacidade para continuar.';
      this.error.set(message);
      this.notificationService.showError(message);
      return;
    }

    this.isLoggingIn.set(true);
    try {
      const loginPromise = this.authService.login(this.email(), this.password());
      const timeoutPromise = new Promise<{ success: boolean; error: string | null }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: false,
              error: 'A autenticação está demorando além do esperado. Tente novamente.',
            }),
          this.LOGIN_UI_TIMEOUT_MS
        )
      );

      const result = await Promise.race([loginPromise, timeoutPromise]);
      if (!result.success || result.error) {
        const message = result.error || 'Erro ao fazer login.';
        this.error.set(message);
        this.notificationService.showError(message);
        return;
      }

      const currentUser = this.authService.currentUser();

      if (currentUser?.must_change_password) {
        await this.router.navigateByUrl('/change-password-required', { replaceUrl: true });
        return;
      }

      const targetUrl = currentUser?.role === 'Solicitante' ? '/requests/new' : '/dashboard';
      await this.router.navigateByUrl(targetUrl, { replaceUrl: true });
    } catch {
      const message = 'Erro ao tentar fazer login. Tente novamente.';
      this.error.set(message);
      this.notificationService.showError(message);
    } finally {
      this.isLoggingIn.set(false);
    }
  }
}

