import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PasswordResetService } from '../../services/password-reset.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div class="bg-white shadow-md rounded-lg p-8 md:p-12 w-full max-w-lg">
        <div class="mb-8 text-center">
          <div class="mb-3 flex justify-center">
            <img src="/company-logo.png" alt="Logo da empresa" class="h-8 md:h-10 w-auto object-contain" />
          </div>
          <h1 class="text-lg md:text-xl font-semibold text-slate-800 leading-tight">Criar Nova Senha</h1>
          <p class="mt-1 text-xs md:text-sm text-slate-500 leading-normal">Defina sua nova senha de acesso</p>
        </div>

        @if (message()) {
          <div class="rounded-md p-4 mb-6 border" [class]="messageType() === 'error' ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'">
            <div class="flex">
              <div class="flex-shrink-0">
                @if (messageType() === 'error') {
                  <svg class="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>
                } @else {
                  <svg class="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>
                }
              </div>
              <div class="ml-3">
                <p class="text-sm font-medium" [class]="messageType() === 'error' ? 'text-red-800' : 'text-green-800'">{{ message() }}</p>
              </div>
            </div>
          </div>
        }

        @if (!isValidToken()) {
          <div class="text-center py-6">
            <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
              <svg class="h-8 w-8 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-2">Link inválido ou expirado</h2>
            <p class="text-sm text-slate-500 mb-6 leading-relaxed">O link de reset deve ser acessado via e-mail e pode ter expirado.</p>
            <button (click)="goToForgotPassword()"
              class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out shadow-lg">
              Solicitar Novo Link
            </button>
          </div>
        }

        @if (isValidToken() && !submitted()) {
          <form (ngSubmit)="onSubmit()" class="space-y-5">
            <div>
              <label for="password" class="block text-sm font-medium text-slate-700">Nova Senha <span class="text-red-500">*</span></label>
              <div class="mt-1 relative rounded-md shadow-sm">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" /></svg>
                </div>
                <input type="password" id="password" [(ngModel)]="password" name="password"
                  class="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Digite sua nova senha" required minlength="6" [disabled]="loading()">
              </div>
              @if (password.length > 0 && password.length < 6) {
                <p class="mt-1 text-xs text-slate-500">Mínimo de 6 caracteres</p>
              }
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-slate-700">Confirmar Senha <span class="text-red-500">*</span></label>
              <div class="mt-1 relative rounded-md shadow-sm">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" /></svg>
                </div>
                <input type="password" id="confirmPassword" [(ngModel)]="confirmPassword" name="confirmPassword"
                  class="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Confirme sua nova senha" required [disabled]="loading()">
              </div>
            </div>

            @if (password && confirmPassword && password !== confirmPassword) {
              <div class="rounded-md bg-red-50 border border-red-200 p-3">
                <p class="text-sm text-red-700 text-center">As senhas não coincidem.</p>
              </div>
            }

            <button type="submit" [disabled]="loading() || !isFormValid()"
              class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out shadow-lg flex items-center justify-center disabled:bg-blue-400 disabled:cursor-not-allowed">
              @if (loading()) {
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Atualizando...</span>
              } @else {
                <span>Atualizar Senha</span>
              }
            </button>
          </form>
        }

        @if (submitted()) {
          <div class="text-center py-6">
            <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <svg class="h-8 w-8 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-2">Senha atualizada com sucesso!</h2>
            <p class="text-sm text-slate-500 leading-relaxed">Você será redirecionado para o login em instantes.</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [],
})
export class ResetPasswordComponent implements OnInit {
  password = '';
  confirmPassword = '';
  loading = signal(false);
  submitted = signal(false);
  message = signal('');
  messageType = signal<'success' | 'error'>('success');
  validToken = signal(false);

  constructor(
    private passwordResetService: PasswordResetService,
    private router: Router
  ) {}

  ngOnInit() {
    if (this.passwordResetService.getResetTokenFromUrl()) {
      this.validToken.set(true);
    } else {
      this.showMessage('Link inválido ou expirado.', 'error');
    }
  }

  isValidToken(): boolean {
    return this.validToken();
  }

  isFormValid(): boolean {
    return this.password.length >= 6 &&
      this.confirmPassword.length >= 6 &&
      this.password === this.confirmPassword;
  }

  async onSubmit() {
    if (!this.isFormValid()) {
      this.showMessage('Verifique os campos e tente novamente.', 'error');
      return;
    }

    this.loading.set(true);
    const result = await this.passwordResetService.confirmPasswordReset(this.password);
    this.loading.set(false);

    if (result.success) {
      this.submitted.set(true);
      this.showMessage(result.message, 'success');

      setTimeout(() => {
        this.router.navigateByUrl('/login', { replaceUrl: true });
      }, 2000);
    } else {
      this.showMessage(result.error || result.message, 'error');
    }
  }

  goToForgotPassword() {
    this.router.navigateByUrl('/forgot-password', { replaceUrl: true });
  }

  private showMessage(text: string, type: 'success' | 'error') {
    this.message.set(text);
    this.messageType.set(type);
  }
}
