import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PasswordResetService } from '../../services/password-reset.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-50 flex flex-col justify-center items-center p-4">
      <div class="bg-white shadow-md rounded-lg p-8 md:p-12 w-full max-w-lg">
        <div class="mb-8 text-center">
          <div class="mb-3 flex justify-center">
            <img src="/company-logo.png" alt="Logo da empresa" class="h-8 md:h-10 w-auto object-contain" />
          </div>
          <h1 class="text-lg md:text-xl font-semibold text-slate-800 leading-tight">Recuperar Senha</h1>
          <p class="mt-1 text-xs md:text-sm text-slate-500 leading-normal">Informe seu e-mail para receber o link de recuperação</p>
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

        @if (!submitted()) {
          <form (ngSubmit)="onSubmit()" class="space-y-6">
            <div>
              <label for="email" class="block text-sm font-medium text-slate-700">E-mail <span class="text-red-500">*</span></label>
              <div class="mt-1 relative rounded-md shadow-sm">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
                </div>
                <input type="email" id="email" [(ngModel)]="email" name="email"
                  class="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="seu.email&#64;company.com" required [disabled]="loading()">
              </div>
            </div>

            <button type="submit" [disabled]="loading() || !email"
              class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 ease-in-out shadow-lg flex items-center justify-center disabled:bg-blue-400 disabled:cursor-not-allowed">
              @if (loading()) {
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Enviando...</span>
              } @else {
                <span>Enviar Link de Recuperação</span>
              }
            </button>
          </form>
        } @else {
          <div class="text-center py-6">
            <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
              <svg class="h-8 w-8 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-2">E-mail enviado!</h2>
            <p class="text-sm text-slate-500 mb-6 leading-relaxed">Verifique sua caixa de entrada e clique no link para resetar sua senha.</p>
            <button (click)="backToLogin()" class="w-full bg-slate-100 text-slate-700 font-bold py-3 px-4 rounded-lg hover:bg-slate-200 transition duration-150">
              Voltar ao Login
            </button>
          </div>
        }

        <div class="text-center pt-4 border-t border-slate-200 mt-6">
          <a routerLink="/login" class="text-blue-600 hover:text-blue-700 text-sm font-medium">
            &larr; Voltar ao Login
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class ForgotPasswordComponent {
  email = '';
  loading = signal(false);
  submitted = signal(false);
  message = signal('');
  messageType = signal<'success' | 'error'>('success');

  constructor(
    private passwordResetService: PasswordResetService,
    private router: Router
  ) {}

  async onSubmit() {
    if (!this.email) {
      this.showMessage('Por favor, insira um e-mail válido.', 'error');
      return;
    }

    this.loading.set(true);
    const result = await this.passwordResetService.requestPasswordReset(this.email);
    this.loading.set(false);

    if (result.success) {
      this.submitted.set(true);
      this.showMessage(result.message, 'success');
    } else {
      this.showMessage(result.error || result.message, 'error');
    }
  }

  backToLogin() {
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private showMessage(text: string, type: 'success' | 'error') {
    this.message.set(text);
    this.messageType.set(type);
  }
}
