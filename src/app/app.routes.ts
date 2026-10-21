import { Routes } from '@angular/router';
import { authGuard } from '../guards/auth.guard';

export const APP_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },

  {
    path: 'login',
    loadComponent: () =>
      import('../components/login/login.component').then(m => m.LoginComponent),
    title: 'Login',
  },

  {
    path: 'forgot-password',
    loadComponent: () =>
      import('../components/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
    title: 'Recuperar Senha',
  },

  {
    path: 'reset-password',
    loadComponent: () =>
      import('../components/reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
    title: 'Resetar Senha',
  },

  {
    path: 'change-password-required',
    loadComponent: () =>
      import('../components/change-password-required/change-password-required.component').then(m => m.ChangePasswordRequiredComponent),
    title: 'Alterar Senha Obrigatória',
  },

  {
    path: 'privacy-policy',
    loadComponent: () =>
      import('../components/privacy-policy/privacy-policy.component').then(m => m.PrivacyPolicyComponent),
    title: 'Política de Privacidade',
  },

  {
    path: 'dashboard',
    loadComponent: () =>
      import('../components/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Visualizador'] },
    title: 'Dashboard Gerencial',
  },

  {
    path: 'requests',
    loadComponent: () =>
      import('../components/requests/request-list/request-list.component').then(m => m.RequestListComponent),
    canActivate: [authGuard],
    runGuardsAndResolvers: 'always',
    title: 'Minhas Solicitações',
  },

  {
    path: 'requests/new',
    loadComponent: () =>
      import('../components/requests/request-form/request-form.component').then(m => m.RequestFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Nova Solicitação',
  },

  {
    path: 'requests/in-progress',
    loadComponent: () =>
      import('../components/requests/request-list/request-list.component').then(m => m.RequestListComponent),
    canActivate: [authGuard],
    runGuardsAndResolvers: 'always',
    data: { mode: 'in-progress' },
    title: 'Solicitações em Andamento',
  },

  {
    path: 'requests/all',
    loadComponent: () =>
      import('../components/requests/request-list/request-list.component').then(m => m.RequestListComponent),
    canActivate: [authGuard],
    runGuardsAndResolvers: 'always',
    data: { mode: 'admin', roles: ['Admin', 'Visualizador'] },
    title: 'Todas as Solicitações',
  },

  {
    path: 'requests/:id',
    loadComponent: () =>
      import('../components/requests/request-detail/request-detail.component').then(m => m.RequestDetailComponent),
    canActivate: [authGuard],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    title: 'Detalhes da Solicitação',
  },

  {
    path: 'users',
    loadComponent: () =>
      import('../components/users/user-management/user-management.component').then(m => m.UserManagementComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin'] },
    title: 'Gerenciar Usuários',
  },

  {
    path: 'audit',
    loadComponent: () =>
      import('../components/audit/audit.component').then(m => m.AuditComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin'] },
    title: 'Auditoria',
  },

  // Relatórios Semanal/Mensal PCM removidos — o mesmo conteúdo está na tela de
  // Indicadores (manutencao/indicadores-semanais). Os utils (src/utils/relatorio-*.ts)
  // continuam, usados pelos Indicadores. Link antigo cai no Indicadores.
  { path: 'admin/relatorio-semanal-pcm', redirectTo: 'manutencao/indicadores-semanais' },
  { path: 'admin/relatorio-mensal-pcm', redirectTo: 'manutencao/indicadores-semanais' },

  // Apontamentos descontinuado temporariamente — rotas removidas de propósito
  // (cai no wildcard "**" → página não encontrada). Reativar: restaurar as
  // rotas 'apontamentos' e 'publico/apontamentos' apontando para
  // ApontamentosComponent, e o grupo do menu em sidebar.component.ts.

  // ── Elétrica ──
  {
    path: 'eletrica/reparo-externo/novo',
    loadComponent: () =>
      import('../components/eletrica/reparo-externo-form/reparo-externo-form.component').then(m => m.ReparoExternoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Solicitação de Reparo Externo',
  },
  {
    path: 'eletrica/reparos',
    loadComponent: () =>
      import('../components/eletrica/reparo-externo-lista/reparo-externo-lista.component').then(m => m.ReparoExternoListaComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Reparos Externos',
  },
  {
    path: 'eletrica/reparos/:id',
    loadComponent: () =>
      import('../components/eletrica/reparo-externo-detalhe/reparo-externo-detalhe.component').then(m => m.ReparoExternoDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Reparo Externo',
  },
  // Só supervisor de elétrica / Admin (o menu esconde; a tela manda os outros pra
  // "Acompanhar reparos").
  {
    path: 'eletrica/controle',
    loadComponent: () =>
      import('../components/eletrica/reparo-externo-lista/reparo-externo-lista.component').then(m => m.ReparoExternoListaComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'], mode: 'controle' },
    title: 'Controle de Reparos Externos',
  },
  // Ensaios Elétricos (motores e transformadores) — rotas fixas antes das com :id.
  {
    path: 'eletrica/ensaios',
    loadComponent: () =>
      import('../components/eletrica/ensaios-lista/ensaios-lista.component').then(m => m.EnsaiosListaComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Equipamentos e ensaios',
  },
  {
    path: 'eletrica/ensaios/novo',
    loadComponent: () =>
      import('../components/eletrica/ensaio-form/ensaio-form.component').then(m => m.EnsaioFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Lançar Ensaio',
  },
  {
    path: 'eletrica/ensaios/equipamentos/novo',
    loadComponent: () =>
      import('../components/eletrica/equipamento-novo/equipamento-novo.component').then(m => m.EquipamentoNovoComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Cadastrar Equipamento',
  },
  {
    path: 'eletrica/ensaios/motores/novo',
    loadComponent: () =>
      import('../components/eletrica/motor-form/motor-form.component').then(m => m.MotorFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Cadastrar Motor',
  },
  {
    path: 'eletrica/ensaios/motores/:id/editar',
    loadComponent: () =>
      import('../components/eletrica/motor-form/motor-form.component').then(m => m.MotorFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Editar Motor',
  },
  {
    path: 'eletrica/ensaios/motores/:id',
    loadComponent: () =>
      import('../components/eletrica/motor-detalhe/motor-detalhe.component').then(m => m.MotorDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Motor',
  },
  {
    path: 'eletrica/ensaios/trafos/novo',
    loadComponent: () =>
      import('../components/eletrica/trafo-form/trafo-form.component').then(m => m.TrafoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Cadastrar Transformador',
  },
  {
    path: 'eletrica/ensaios/trafos/:id/editar',
    loadComponent: () =>
      import('../components/eletrica/trafo-form/trafo-form.component').then(m => m.TrafoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Editar Transformador',
  },
  {
    path: 'eletrica/ensaios/trafos/:id',
    loadComponent: () =>
      import('../components/eletrica/trafo-detalhe/trafo-detalhe.component').then(m => m.TrafoDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Transformador',
  },
  {
    path: 'eletrica/ensaios/trafo/novo',
    loadComponent: () =>
      import('../components/eletrica/ensaio-trafo-form/ensaio-trafo-form.component').then(m => m.EnsaioTrafoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Lançar Ensaio de Transformador',
  },
  {
    path: 'eletrica/ensaios/trafo/:id/editar',
    loadComponent: () =>
      import('../components/eletrica/ensaio-trafo-form/ensaio-trafo-form.component').then(m => m.EnsaioTrafoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Corrigir Ensaio de Transformador',
  },
  {
    path: 'eletrica/ensaios/trafo/:id',
    loadComponent: () =>
      import('../components/eletrica/ensaio-trafo-detalhe/ensaio-trafo-detalhe.component').then(m => m.EnsaioTrafoDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Ensaio de Transformador',
  },
  {
    path: 'eletrica/ensaios/termografia/novo',
    loadComponent: () =>
      import('../components/eletrica/termografia-form/termografia-form.component').then(m => m.TermografiaFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Lançar Termografia',
  },
  {
    path: 'eletrica/ensaios/termografia/:id/editar',
    loadComponent: () =>
      import('../components/eletrica/termografia-form/termografia-form.component').then(m => m.TermografiaFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Corrigir Termografia',
  },
  {
    path: 'eletrica/ensaios/termografia/:id',
    loadComponent: () =>
      import('../components/eletrica/termografia-detalhe/termografia-detalhe.component').then(m => m.TermografiaDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Termografia',
  },
  {
    path: 'eletrica/ensaios/:id/editar',
    loadComponent: () =>
      import('../components/eletrica/ensaio-form/ensaio-form.component').then(m => m.EnsaioFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Corrigir Ensaio',
  },
  {
    path: 'eletrica/ensaios/:id',
    loadComponent: () =>
      import('../components/eletrica/ensaio-detalhe/ensaio-detalhe.component').then(m => m.EnsaioDetalheComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Ensaio de Isolamento',
  },

  {
    path: 'fundo-fixo',
    loadComponent: () =>
      import('../components/fundo-fixo/fundo-fixo-list/fundo-fixo-list.component').then(m => m.FundoFixoListComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin'], mode: 'gestao' },
    title: 'Fundo Fixo',
  },
  {
    path: 'fundo-fixo/lista',
    loadComponent: () =>
      import('../components/fundo-fixo/fundo-fixo-list/fundo-fixo-list.component').then(m => m.FundoFixoListComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'], mode: 'compras' },
    title: 'Lista de Compras — Fundo Fixo',
  },
  {
    path: 'fundo-fixo/nova',
    loadComponent: () =>
      import('../components/fundo-fixo/fundo-fixo-form/fundo-fixo-form.component').then(m => m.FundoFixoFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante'] },
    title: 'Nova Solicitação — Fundo Fixo',
  },
  {
    path: 'publico/fundo-fixo',
    loadComponent: () =>
      import('../components/fundo-fixo/fundo-fixo-form-publico/fundo-fixo-form-publico.component').then(m => m.FundoFixoFormPublicoComponent),
    title: 'Solicitar Compra — Fundo Fixo',
  },
  {
    path: 'publico/fundo-fixo/decisao',
    loadComponent: () =>
      import('../components/fundo-fixo/fundo-fixo-decisao-publico/fundo-fixo-decisao-publico.component').then(m => m.FundoFixoDecisaoPublicoComponent),
    title: 'Aprovação — Fundo Fixo',
  },
  {
    path: 'publico/kanban-oficina',
    loadComponent: () =>
      import('../components/manutencao/kanban-oficina/kanban-oficina-publico.component').then(m => m.KanbanOficinaPublicoComponent),
    title: 'Kanban da Oficina',
  },
  {
    path: 'publico/indicadores-manutencao',
    loadComponent: () =>
      import('../components/manutencao/manutencao-indicadores-semanais/manutencao-indicadores-publico.component').then(m => m.ManutencaoIndicadoresPublicoComponent),
    title: 'Indicadores de Manutenção',
  },

  {
    path: 'manutencao/indicadores-semanais',
    loadComponent: () =>
      import('../components/manutencao/manutencao-indicadores-semanais/manutencao-indicadores-semanais.component').then(m => m.ManutencaoIndicadoresSemanaisComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Acompanhamento de Indicadores Semanais',
  },
  {
    path: 'manutencao/planos',
    loadComponent: () =>
      import('../components/manutencao/manutencao-planos/manutencao-planos.component').then(m => m.ManutencaoPlanosComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Planos de Manutenção',
  },
  {
    path: 'manutencao/programacao',
    loadComponent: () =>
      import('../components/manutencao/manutencao-programacao/manutencao-programacao.component').then(m => m.ManutencaoProgramacaoComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Programação de Manutenção',
  },
  {
    path: 'manutencao/programacao/eletrica',
    loadComponent: () =>
      import('../components/manutencao/manutencao-programacao/manutencao-programacao.component').then(m => m.ManutencaoProgramacaoComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'], area: 'ELETRICA' },
    title: 'Programação Elétrica',
  },
  {
    path: 'manutencao/programacao/mecanica',
    loadComponent: () =>
      import('../components/manutencao/manutencao-programacao/manutencao-programacao.component').then(m => m.ManutencaoProgramacaoComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'], area: 'MECANICA' },
    title: 'Programação Mecânica',
  },
  {
    path: 'manutencao/programacao/apoio',
    loadComponent: () =>
      import('../components/manutencao/manutencao-programacao/manutencao-programacao.component').then(m => m.ManutencaoProgramacaoComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'], area: 'APOIO' },
    title: 'Programação Apoio',
  },

  {
    path: 'almoxarifado/aguardando',
    loadComponent: () => import('../components/almoxarifado/almox-aguardando/almox-aguardando.component').then(m => m.AlmoxAguardandoComponent),
    canActivate: [authGuard],
    title: 'Materiais Aguardando Retirada',
  },
  {
    path: 'almoxarifado/entradas',
    loadComponent: () => import('../components/almoxarifado/almox-entradas/almox-entradas.component').then(m => m.AlmoxEntradasComponent),
    canActivate: [authGuard],
    title: 'Entradas por Período',
  },
  {
    path: 'almoxarifado/saidas',
    loadComponent: () => import('../components/almoxarifado/almox-saidas/almox-saidas.component').then(m => m.AlmoxSaidasComponent),
    canActivate: [authGuard],
    title: 'Saídas por Período',
  },
  {
    path: 'almoxarifado/importar',
    loadComponent: () => import('../components/almoxarifado/almox-importar/almox-importar.component').then(m => m.AlmoxImportarComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin'] },
    title: 'Importar Dados — Almoxarifado',
  },

  {
    path: 'materials-dashboard',
    loadComponent: () =>
      import('../components/materials/materials-dashboard/materials-dashboard.component').then(m => m.MaterialsDashboardComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Dashboard de Materiais',
  },

  {
    path: 'profile',
    loadComponent: () =>
      import('../components/profile/profile.component').then(m => m.ProfileComponent),
    canActivate: [authGuard],
    title: 'Meu Perfil',
  },

  {
    path: 'my-materials',
    loadComponent: () =>
      import('../components/materials/my-materials/my-materials.component').then(m => m.MyMaterialsComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Meus Materiais',
  },

  {
    path: 'materials/new',
    loadComponent: () =>
      import('../components/materials/material-form/material-form.component').then(m => m.MaterialFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Cadastrar Material',
  },

  {
    path: 'materials',
    loadComponent: () =>
      import('../components/materials/material-list/material-list.component').then(m => m.MaterialListComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Materiais',
  },

  {
    path: 'materials/:id',
    loadComponent: () =>
      import('../components/materials/material-form/material-form.component').then(m => m.MaterialFormComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Detalhes do Material',
  },

  {
    path: '**',
    loadComponent: () =>
      import('../components/not-found/not-found.component').then(m => m.NotFoundComponent),
    title: 'Página não encontrada',
  },
];
