import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { SupabaseService } from '../../services/supabase.service';
import { AuditLogService } from '../../services/audit-log.service';

@Component({
  selector: 'app-change-password-required',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './change-password-required.component.html',
  styleUrls: ['./change-password-required.component.css']
})
export class ChangePasswordRequiredComponent {
  public router = inject(Router);

  async closeModal() {
    // Garante que o usuário será deslogado ao tentar fechar o popup
    await this.authService.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private supabaseService = inject(SupabaseService);
  private auditLogService = inject(AuditLogService);
  private fb = inject(FormBuilder);

  form: FormGroup;
  isLoading = signal(false);
  showPassword = signal(false);
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  constructor() {
    this.form = this.fb.group({
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordsMatchValidator });
  }

  private passwordsMatchValidator(group: FormGroup): { [key: string]: boolean } | null {
    const newPass = group.get('newPassword')?.value;
    const confirmPass = group.get('confirmPassword')?.value;
    return newPass === confirmPass ? null : { passwordsMismatch: true };
  }

  togglePasswordVisibility(field: 'current' | 'new' | 'confirm') {
    if (field === 'current') this.showPassword.update(v => !v);
    if (field === 'new') this.showNewPassword.update(v => !v);
    if (field === 'confirm') this.showConfirmPassword.update(v => !v);
  }

  async onSubmit() {
    if (this.form.invalid) return;

    this.isLoading.set(true);

    try {
      const newPassword = this.form.get('newPassword')?.value;
      const currentUser = this.authService.currentUser();

      if (!currentUser?.id || !currentUser?.email) {
        this.notificationService.showError('Usuário não identificado. Faça login novamente.');
        this.isLoading.set(false);
        await this.router.navigateByUrl('/login', { replaceUrl: true });
        return;
      }

      // 1. Atualizar a senha no Supabase Auth
      console.log('[ChangePasswordRequired] Updating password...');
      const { error: updateError } = await this.supabaseService.client.auth.updateUser({
        password: newPassword
      });

      if (updateError) {
        console.error('[ChangePasswordRequired] Update password error:', updateError);
        this.notificationService.showError('Erro ao atualizar senha: ' + (updateError.message || 'Erro desconhecido'));
        this.isLoading.set(false);
        return;
      }

      console.log('[ChangePasswordRequired] Password updated successfully');

      // 2. Marcar flag must_change_password no banco
      try {
        await this.supabaseService.client
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', currentUser.id);
        console.log('[ChangePasswordRequired] must_change_password flag updated');
      } catch (err) {
        console.warn('[ChangePasswordRequired] Failed to update flag, continuing...', err);
      }

      // 3. Registrar no audit log
      this.auditLogService.log({
        user_id: currentUser.id,
        user_name: currentUser.name,
        event_type: 'password_change',
        resource_type: 'auth',
        description: `${currentUser.name} alterou a senha obrigatória`,
      });

      this.notificationService.showSuccess('Senha alterada com sucesso! Faça login novamente com sua nova senha.');

      this.isLoading.set(false);

      try {
        await this.authService.logout();
      } catch (err) {
        console.warn('[ChangePasswordRequired] Logout error, forcing redirect...', err);
      }

      await this.router.navigateByUrl('/login', { replaceUrl: true });

    } catch (error) {
      console.error('[ChangePasswordRequired] Unexpected error:', error);
      this.notificationService.showError('Erro inesperado ao alterar senha. Tente novamente.');
      this.isLoading.set(false);
    }
  }
}


