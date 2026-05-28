import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-50 py-8 px-4">
      <div class="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8 md:p-12">
        <div class="mb-8 flex items-center justify-between">
          <h1 class="text-2xl font-bold text-gray-800">Política de Privacidade</h1>
          <a routerLink="/login" class="text-blue-600 hover:text-blue-700 text-sm font-medium">&larr; Voltar ao Login</a>
        </div>

        <div class="prose prose-sm max-w-none text-gray-700 space-y-6">
          <p class="text-sm text-gray-500">Última atualização: 24 de março de 2026</p>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">1. Controlador dos Dados</h2>
            <p>O <strong>Portal PPTM</strong> é operado internamente pela empresa para gerenciamento de solicitações de compras, materiais e estoque de segurança. O departamento de TI é responsável pelo tratamento dos dados pessoais coletados nesta plataforma.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">2. Dados Pessoais Coletados</h2>
            <p>Coletamos os seguintes dados pessoais, estritamente necessários para o funcionamento do sistema:</p>
            <ul class="list-disc pl-6 space-y-1">
              <li><strong>Nome completo</strong> — identificação do usuário nas solicitações</li>
              <li><strong>E-mail corporativo</strong> — autenticação e comunicação</li>
              <li><strong>Departamento e cargo</strong> — controle de permissões e fluxo de aprovação</li>
              <li><strong>Perfil de acesso (role)</strong> — controle de acesso ao sistema</li>
            </ul>
            <p>Não coletamos dados pessoais sensíveis conforme definidos no Art. 5, II da LGPD.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">3. Finalidade do Tratamento</h2>
            <p>Os dados pessoais são tratados com as seguintes finalidades (Art. 7, LGPD):</p>
            <ul class="list-disc pl-6 space-y-1">
              <li>Autenticação e controle de acesso ao sistema</li>
              <li>Registro e rastreamento de solicitações de compra</li>
              <li>Gestão de materiais e estoque de segurança</li>
              <li>Notificações sobre atualizações de solicitações e materiais</li>
              <li>Auditoria e histórico de ações no sistema</li>
            </ul>
            <p><strong>Base legal:</strong> Execução de contrato de trabalho e legítimo interesse do empregador para gestão operacional (Art. 7, V e IX da LGPD).</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">4. Compartilhamento de Dados</h2>
            <p>Os dados pessoais podem ser compartilhados com:</p>
            <ul class="list-disc pl-6 space-y-1">
              <li><strong>Supabase Inc.</strong> — provedor de infraestrutura de banco de dados e autenticação (dados armazenados com criptografia)</li>
              <li><strong>Vercel Inc.</strong> — provedor de hospedagem da aplicação</li>
            </ul>
            <p>Ambos os provedores possuem políticas de privacidade compatíveis com padrões internacionais de proteção de dados. Não comercializamos ou compartilhamos dados com terceiros para fins de marketing.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">5. Retenção de Dados</h2>
            <p>Os dados pessoais são mantidos enquanto:</p>
            <ul class="list-disc pl-6 space-y-1">
              <li>O vínculo do colaborador com a empresa estiver ativo</li>
              <li>Houver necessidade legal ou regulatória de retenção</li>
              <li>Registros de auditoria: mantidos pelo período necessário para fins de compliance</li>
            </ul>
            <p>Após o desligamento, os dados podem ser anonimizados ou excluídos mediante solicitação.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">6. Direitos do Titular (Art. 18, LGPD)</h2>
            <p>Você possui os seguintes direitos em relação aos seus dados pessoais:</p>
            <ul class="list-disc pl-6 space-y-1">
              <li><strong>Acesso</strong> — solicitar quais dados seus são tratados</li>
              <li><strong>Correção</strong> — solicitar a correção de dados incompletos ou desatualizados</li>
              <li><strong>Eliminação</strong> — solicitar a exclusão de dados desnecessários</li>
              <li><strong>Portabilidade</strong> — solicitar a transferência dos seus dados</li>
              <li><strong>Informação</strong> — ser informado sobre o compartilhamento dos seus dados</li>
              <li><strong>Revogação</strong> — revogar o consentimento a qualquer momento</li>
            </ul>
            <p>Para exercer qualquer um desses direitos, entre em contato com o departamento de TI ou o administrador do sistema.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">7. Segurança dos Dados</h2>
            <p>Adotamos as seguintes medidas técnicas e administrativas para proteção dos dados:</p>
            <ul class="list-disc pl-6 space-y-1">
              <li>Autenticação segura com criptografia de senhas</li>
              <li>Comunicação via HTTPS (TLS) em todas as transmissões</li>
              <li>Controle de acesso baseado em perfis (RBAC)</li>
              <li>Timeout automático de sessão por inatividade</li>
              <li>Troca obrigatória de senha no primeiro acesso</li>
              <li>Políticas de segurança a nível de banco de dados (RLS)</li>
            </ul>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">8. Alterações nesta Política</h2>
            <p>Esta política pode ser atualizada periodicamente. Alterações significativas serão comunicadas aos usuários através do sistema de notificações da plataforma.</p>
          </section>

          <section>
            <h2 class="text-lg font-semibold text-gray-800">9. Contato</h2>
            <p>Em caso de dúvidas sobre esta política ou sobre o tratamento dos seus dados pessoais, entre em contato com o departamento de TI responsável pela administração do Portal PPTM.</p>
          </section>

          <div class="mt-8 pt-6 border-t border-gray-200 text-center">
            <p class="text-xs text-gray-400">Portal PPTM — Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018)</p>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PrivacyPolicyComponent {}
