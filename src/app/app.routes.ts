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

  {
    path: 'safety-stock',
    loadComponent: () =>
      import('../components/safety-stock/safety-stock.component').then(m => m.SafetyStockComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin', 'Solicitante', 'Visualizador'] },
    title: 'Gestão à vista do Estoque de Segurança',
  },

  {
    path: 'apontamentos',
    loadComponent: () =>
      import('../components/apontamentos/apontamentos.component').then(m => m.ApontamentosComponent),
    canActivate: [authGuard],
    data: { roles: ['Admin'] },
    title: 'Apontamentos',
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
