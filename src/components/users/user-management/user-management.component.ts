import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { UserService } from '../../../services/user.service';
import { UserProfile, UserRole } from '../../../models/user.model';
import { AuthService } from '../../../services/auth.service';
import { NotificationService } from '../../../services/notification.service';

type NewUserForm = Omit<UserProfile, 'id'> & { password?: string };

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './user-management.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserManagementComponent {
  users;
  currentUser;

  editingUser = signal<UserProfile | null>(null);
  isSavingEdit = signal(false);

  isAddingUser = signal(false);
  isSavingNew = signal(false);
  newUser = signal<NewUserForm>(this.getInitialNewUser());
  addUserError = signal<string | null>(null);

  deletingUserId = signal<string | null>(null);
  resettingPasswordUserId = signal<string | null>(null);

  showResetPasswordModal = signal(false);
  selectedUserForReset = signal<UserProfile | null>(null);
  resetPasswordOption = signal<'email' | 'sql' | null>(null);

  userRoles: UserRole[] = ['Solicitante', 'Admin', 'Visualizador'];

  constructor(
    public userService: UserService,
    public authService: AuthService,
    public notificationService: NotificationService
  ) {
    this.users = this.userService.users;
    this.currentUser = this.authService.currentUser;
  }

  private getInitialNewUser(): NewUserForm {
    return {
      name: '',
      email: '',
      department: '',
      position: '',
      role: 'Solicitante',
      password: '',
      must_change_password: true,
    };
  }

  updateNewUser(patch: Partial<NewUserForm>): void {
    this.newUser.update(current => ({ ...current, ...patch }));
  }

  editUser(user: UserProfile): void {
    this.editingUser.set(JSON.parse(JSON.stringify(user)));
  }

  cancelEdit(): void {
    this.editingUser.set(null);
  }

  async saveUser(): Promise<void> {
    const userToSave = this.editingUser();
    if (!userToSave) return;

    this.isSavingEdit.set(true);
    const { id, ...userData } = userToSave;
    const updatePayload = {
      name: userData.name,
      email: userData.email,
      department: userData.department,
      position: userData.position,
      role: userData.role,
    };

    try {
      const updatePromise = this.userService.updateUser(id, updatePayload);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );

      const result = await Promise.race([updatePromise, timeoutPromise]) as any;

      if (result.success) {
        this.notificationService.showSuccess(`Usuário ${userToSave.name} atualizado com sucesso.`);
        this.editingUser.set(null);
      } else {
        this.notificationService.showError(`Erro ao atualizar usuário: ${result.error}`);
      }
    } catch (error: any) {
      this.notificationService.showError(`Erro ao atualizar usuário: ${error.message || 'Timeout'}`);
    } finally {
      this.isSavingEdit.set(false);
    }
  }

  openAddUserModal(): void {
    this.newUser.set(this.getInitialNewUser());
    this.addUserError.set(null);
    this.isAddingUser.set(true);
  }

  cancelAddUser(): void {
    this.addUserError.set(null);
    this.isAddingUser.set(false);
  }

  async saveNewUser(): Promise<void> {
    this.addUserError.set(null);
    this.isSavingNew.set(true);

    const newUserDraft = this.newUser();
    const password = newUserDraft.password || '';
    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
    if (!strongRegex.test(password)) {
      this.addUserError.set('A senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e símbolo.');
      this.isSavingNew.set(false);
      return;
    }

    try {
      const addUserPromise = this.userService.addUser({ ...newUserDraft });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 20000)
      );

      const result = await Promise.race([addUserPromise, timeoutPromise]) as any;

      if (result.success) {
        setTimeout(() => {
          this.notificationService.showSuccess(`Usuário ${newUserDraft.name} criado com sucesso.`);
          this.isAddingUser.set(false);
        }, 300);
      } else {
        let friendlyError = 'Ocorreu um erro desconhecido ao criar o usuário.';
        if (result.error?.toLowerCase().includes('user already registered')) {
          friendlyError =
            'Este e-mail já está em uso. Isso geralmente ocorre quando a "Confirmação de E-mail" está ativa e um usuário foi criado, mas ainda não confirmou a conta. ' +
            'O usuário não aparecerá na lista até a confirmação do e-mail. ' +
            'Peça para o usuário verificar caixa de entrada e spam, ou exclua o usuário pendente no painel do Supabase (Authentication) para tentar o cadastro novamente.';
        } else if (result.error) {
          friendlyError = result.error;
        }
        this.addUserError.set(friendlyError);
      }
    } catch (error: any) {
      this.addUserError.set(`Erro ao criar usuário: ${error.message || 'Timeout'}`);
    } finally {
      this.isSavingNew.set(false);
    }
  }

  async deleteUser(userToDelete: UserProfile): Promise<void> {
    if (userToDelete.id === this.currentUser()?.id) {
      alert('Você não pode excluir sua própria conta.');
      return;
    }

    if (!confirm(`Tem certeza que deseja excluir o usuário ${userToDelete.name}? Esta ação não pode ser desfeita.`)) {
      return;
    }

    this.deletingUserId.set(userToDelete.id);
    try {
      const deletePromise = this.userService.deleteUser(userToDelete.id);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operação demorou muito. Tente novamente.')), 15000)
      );

      await Promise.race([deletePromise, timeoutPromise]);
      this.notificationService.showSuccess(`Usuário ${userToDelete.name} excluído com sucesso.`);
    } catch (error: any) {
      this.notificationService.showError(`Erro ao excluir usuário: ${error.message || 'Timeout'}`);
    } finally {
      this.deletingUserId.set(null);
    }
  }

  async resetPassword(user: UserProfile): Promise<void> {
    this.selectedUserForReset.set(user);
    this.showResetPasswordModal.set(true);
    this.resetPasswordOption.set(null);
  }

  closeResetPasswordModal(): void {
    this.showResetPasswordModal.set(false);
    this.selectedUserForReset.set(null);
    this.resetPasswordOption.set(null);
  }

  async sendResetEmail(): Promise<void> {
    const user = this.selectedUserForReset();
    if (!user) return;

    this.resettingPasswordUserId.set(user.id);
    const result = await this.userService.resetPassword(user.id, user.email);
    this.resettingPasswordUserId.set(null);

    if (result.success) {
      this.notificationService.showSuccess(`E-mail de recuperação enviado para ${user.email}.`);
      this.closeResetPasswordModal();
    } else {
      this.notificationService.showError(result.error || 'Erro ao enviar e-mail.');
    }
  }

  async resetPasswordDirectly(): Promise<void> {
    const user = this.selectedUserForReset();
    if (!user) return;

    const confirmMsg =
      `Resetar a senha de ${user.name} para "Pptm@123"?\n\n` +
      `Após confirmar, o sistema tentará resetar automaticamente (sem precisar de SQL).\n` +
      `Se falhar, você ainda pode usar o SQL como alternativa.`;

    if (!confirm(confirmMsg)) return;

    this.resettingPasswordUserId.set(user.id);
    const result = await this.userService.resetPasswordInstant(user.id);
    this.resettingPasswordUserId.set(null);

    if (result.success) {
      this.notificationService.showSuccess('Senha resetada com sucesso. Nova senha: Pptm@123');
      this.closeResetPasswordModal();
      return;
    }

    // Fallback: copiar SQL para o admin executar manualmente
    const copied = await this.copySqlToClipboard({ silent: true });
    this.notificationService.showError(
      (result.error || 'Falha ao resetar automaticamente.') +
      (copied
        ? '\n\nSQL copiado para alternativa manual no Supabase SQL Editor.'
        : '\n\nFalha ao copiar o SQL. Copie manualmente do modal e execute no Supabase SQL Editor.')
    );
  }

  async copySqlToClipboard(options: { silent?: boolean } = {}): Promise<boolean> {
    const user = this.selectedUserForReset();
    if (!user) return false;

    const sql = `-- Cole este SQL no Supabase SQL Editor e execute
UPDATE auth.users
SET
  encrypted_password = crypt('Pptm@123', gen_salt('bf')),
  email_confirmed_at = now(),
  confirmation_token = '',
  recovery_token = '',
  banned_until = NULL,
  deleted_at = NULL,
  updated_at = now()
WHERE email = '${user.email}';`;

    try {
      await navigator.clipboard.writeText(sql);
      this.resetPasswordOption.set('sql');
      if (!options.silent) {
        this.notificationService.showSuccess('SQL copiado. Cole no Supabase SQL Editor e execute.');
      }
      return true;
    } catch {
      if (!options.silent) {
        this.notificationService.showError('Erro ao copiar. Copie manualmente do modal.');
      }
      return false;
    }
  }

  getSqlForUser(): string {
    const user = this.selectedUserForReset();
    if (!user) return '';

    return `UPDATE auth.users
SET
  encrypted_password = crypt('Pptm@123', gen_salt('bf')),
  email_confirmed_at = now(),
  confirmation_token = '',
  recovery_token = '',
  banned_until = NULL,
  deleted_at = NULL,
  updated_at = now()
WHERE email = '${user.email}';`;
  }

  public trackUserId(index: number, user: UserProfile) {
    return user.id;
  }

  public strongPassword(password: string): boolean {
    return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(password || '');
  }

  get passwordLength(): number {
    const user = this.newUser?.();
    return user && user.password ? user.password.length : 0;
  }

  get isStrongPassword(): boolean {
    const user = this.newUser?.();
    return !!user && this.strongPassword(user.password || '');
  }
}
