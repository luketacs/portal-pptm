import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { SupabaseService } from '../../services/supabase.service';
import { NotificationService } from '../../services/notification.service';
import { AuditLogService } from '../../services/audit-log.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileComponent implements OnInit {
  currentUser = this.authService.currentUser;

  profileForm!: FormGroup;
  passwordForm!: FormGroup;

  isSavingProfile = signal(false);
  isSavingPassword = signal(false);
  profileSuccess = signal('');
  profileError = signal('');
  passwordSuccess = signal('');
  passwordError = signal('');
  showNewPassword = signal(false);
  showConfirmPassword = signal(false);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService,
    private supabaseService: SupabaseService,
    private notificationService: NotificationService,
    private auditLogService: AuditLogService
  ) {}

  get isAdmin(): boolean {
    return this.currentUser()?.role === 'Admin';
  }

  ngOnInit(): void {
    const user = this.currentUser();
    const isAdmin = this.isAdmin;
    this.profileForm = this.fb.group({
      name:       [user?.name ?? '',       [Validators.required, Validators.minLength(2)]],
      department: [{ value: user?.department ?? '', disabled: !isAdmin }, []],
      position:   [{ value: user?.position ?? '',   disabled: !isAdmin }, []],
    });

    this.passwordForm = this.fb.group({
      newPassword:     ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    }, { validators: this.passwordsMatch });
  }

  private passwordsMatch(group: FormGroup): { mismatch: true } | null {
    return group.get('newPassword')?.value === group.get('confirmPassword')?.value
      ? null
      : { mismatch: true };
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.isSavingProfile()) return;
    const user = this.currentUser();
    if (!user) return;

    this.isSavingProfile.set(true);
    this.profileError.set('');
    this.profileSuccess.set('');

    const { name, department, position } = this.profileForm.getRawValue() as {
      name: string; department: string; position: string;
    };

    const result = await this.userService.updateUser(user.id, {
      name: name.trim(),
      department: department.trim() || undefined,
      position: position.trim() || undefined,
    });

    if (result.success) {
      this.profileSuccess.set('Dados atualizados com sucesso!');
      setTimeout(() => this.profileSuccess.set(''), 4000);
    } else {
      this.profileError.set(result.error ?? 'Erro ao salvar dados.');
    }

    this.isSavingProfile.set(false);
  }

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid || this.isSavingPassword()) return;
    const user = this.currentUser();
    if (!user) return;

    this.isSavingPassword.set(true);
    this.passwordError.set('');
    this.passwordSuccess.set('');

    const { newPassword } = this.passwordForm.getRawValue() as { newPassword: string };

    const { error } = await this.supabaseService.client.auth.updateUser({ password: newPassword });

    if (error) {
      this.passwordError.set(error.message || 'Erro ao atualizar senha.');
    } else {
      this.passwordSuccess.set('Senha alterada com sucesso!');
      this.passwordForm.reset();

      this.auditLogService.log({
        user_id: user.id,
        user_name: user.name,
        event_type: 'password_change',
        resource_type: 'auth',
        description: `${user.name} alterou a própria senha`,
      });

      setTimeout(() => this.passwordSuccess.set(''), 4000);
    }

    this.isSavingPassword.set(false);
  }

  toggleShowNew(): void { this.showNewPassword.update(v => !v); }
  toggleShowConfirm(): void { this.showConfirmPassword.update(v => !v); }

  get roleLabel(): string {
    const map: Record<string, string> = {
      Admin: 'Administrador',
      Solicitante: 'Solicitante',
      Visualizador: 'Visualizador',
    };
    return map[this.currentUser()?.role ?? ''] ?? this.currentUser()?.role ?? '';
  }
}
