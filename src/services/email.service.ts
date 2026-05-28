import { Injectable } from '@angular/core';

const PORTAL_URL = 'https://portalpptm.vercel.app';

@Injectable({ providedIn: 'root' })
export class EmailService {

  // Abre o cliente de e-mail (Outlook, Gmail, etc.) com tudo pré-preenchido
  openRequestStatusEmail(opts: {
    to: string;
    requesterName: string;
    materialCode: string;
    materialDescription: string;
    newStatus: string;
    requestId: string;
    changedByName: string;
    reason?: string;
  }): void {
    const reasonLine = opts.reason ? `\nMotivo: ${opts.reason}` : '';
    const body = [
      `Olá, ${opts.requesterName}!`,
      '',
      `O status da sua solicitação foi atualizado:`,
      '',
      `Material: ${opts.materialCode} — ${opts.materialDescription}`,
      `Novo status: ${opts.newStatus}`,
      `Atualizado por: ${opts.changedByName}`,
      reasonLine,
      '',
      `Acesse a solicitação: ${PORTAL_URL}/requests/${opts.requestId}`,
      '',
      '---',
      'Portal de Compras PPTM',
    ].join('\n');

    const subject = `[Portal PPTM] Solicitação ${opts.materialCode} → ${opts.newStatus}`;
    window.location.href = `mailto:${opts.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  openMaterialReleasedEmail(opts: {
    to: string;
    creatorName: string;
    materialDescription: string;
    materialCode: string | null | undefined;
    releasedByName: string;
  }): void {
    const codeInfo = opts.materialCode ? `\nCódigo: ${opts.materialCode}` : '';
    const body = [
      `Olá, ${opts.creatorName}!`,
      '',
      `Seu material foi LIBERADO e já está disponível para uso em solicitações de compra:`,
      '',
      `Material: ${opts.materialDescription}`,
      codeInfo,
      `Liberado por: ${opts.releasedByName}`,
      '',
      `Acesse o portal: ${PORTAL_URL}/requests/new`,
      '',
      '---',
      'Portal de Compras PPTM',
    ].join('\n');

    const subject = `[Portal PPTM] Material liberado: ${opts.materialDescription}`;
    window.location.href = `mailto:${opts.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  openWelcomeEmail(opts: {
    to: string;
    name: string;
    role: string;
    tempPassword?: string;
  }): void {
    const roleLabel: Record<string, string> = {
      Admin: 'Administrador', Solicitante: 'Solicitante', Visualizador: 'Visualizador',
    };
    const passLine = opts.tempPassword ? `\nSenha temporária: ${opts.tempPassword}` : '';
    const body = [
      `Bem-vindo(a), ${opts.name}!`,
      '',
      `Sua conta no Portal de Compras PPTM foi criada.`,
      '',
      `E-mail: ${opts.to}`,
      `Perfil: ${roleLabel[opts.role] ?? opts.role}`,
      passLine,
      opts.tempPassword ? '\nVocê será solicitado a trocar a senha no primeiro acesso.' : '',
      '',
      `Acesse o portal: ${PORTAL_URL}`,
      '',
      '---',
      'Portal de Compras PPTM',
    ].join('\n');

    const subject = `[Portal PPTM] Bem-vindo! Sua conta foi criada`;
    window.location.href = `mailto:${opts.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}
