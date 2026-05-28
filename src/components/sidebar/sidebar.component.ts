import { ChangeDetectionStrategy, Component, OnDestroy, computed, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserRole } from '../../models/user.model';
import { SafeHtmlPipe } from '../../pipes/safe-html.pipe';

interface NavLink {
  path: string;
  label: string;
  icon: string;
  roles: UserRole[];
}

interface NavGroup {
  id: string;
  label: string;
  icon: string;
  roles: UserRole[];
  links: NavLink[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, SafeHtmlPipe],
  templateUrl: './sidebar.component.html',
  styles: [`
    .sidebar-nav {
      overflow-y: auto;
    }

    .icon-slot {
      width: 1.25rem;
      height: 1.25rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .nav-link,
    .nav-group-trigger {
      width: 100%;
      display: flex;
      align-items: center;
      padding: 0.64rem 0.72rem;
      border-radius: 0.66rem;
      font-size: 0.875rem;
      font-weight: 600;
      transition: background-color 0.2s ease, color 0.2s ease;
    }

    .nav-link.active,
    .nav-group-trigger.active {
      background-color: #eff6ff;
      color: #1d4ed8;
    }

    .nav-link.active :is(svg),
    .nav-group-trigger.active :is(svg) {
      color: #2563eb;
    }

    .nav-link:not(.active),
    .nav-group-trigger:not(.active) {
      color: #4b5563;
    }

    .nav-link:not(.active) :is(svg),
    .nav-group-trigger:not(.active) :is(svg) {
      color: #6b7280;
    }

    .nav-link:not(.active):hover,
    .nav-group-trigger:not(.active):hover {
      background-color: #f3f4f6;
      color: #111827;
    }

    .nav-link:not(.active):hover :is(svg),
    .nav-group-trigger:not(.active):hover :is(svg) {
      color: #1f2937;
    }

    .nav-group + .nav-group {
      margin-top: 0.25rem;
    }

    .chevron {
      width: 1rem;
      height: 1rem;
      color: #94a3b8;
      transition: transform 0.2s ease;
    }

    .chevron.expanded {
      transform: rotate(180deg);
    }

    .nav-submenu {
      margin-left: 0.6rem;
      margin-top: 0.35rem;
      padding-left: 0.6rem;
      border-left: 1px solid #e2e8f0;
      display: grid;
      gap: 0.16rem;
    }

    .submenu-link {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.46rem 0.6rem;
      border-radius: 0.52rem;
      font-size: 0.81rem;
      color: #64748b;
      transition: background-color 0.2s ease, color 0.2s ease;
    }

    .submenu-link:hover {
      background: #f8fafc;
      color: #1f2937;
    }

    .submenu-link.active {
      background: #eff6ff;
      color: #1d4ed8;
      font-weight: 600;
    }

    .submenu-dot {
      width: 0.38rem;
      height: 0.38rem;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.6;
      flex-shrink: 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent implements OnDestroy {
  currentUser;

  private routerSubscription?: Subscription;
  currentUrl = signal('/');
  expandedGroups = signal<Record<string, boolean>>({
    dashboards: false,
    requests: false,
    materials: false,
    admin: false,
    apontamentos: false,
    almoxarifado: false,
    estoque: false,
    profile: false,
  });

  constructor(public authService: AuthService, private router: Router) {
    this.currentUser = this.authService.currentUser;
    this.currentUrl.set(this.router.url || '/');

    this.routerSubscription = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        const url = event.urlAfterRedirects || event.url;
        this.currentUrl.set(url);
      }
    });
  }

  navGroups: NavGroup[] = [
    {
      id: 'dashboards',
      label: 'Dashboards',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h5v8H3v-8zm7 4h11v4H10v-4z" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/dashboard', label: 'Solicitações de Compra', icon: '', roles: ['Admin', 'Visualizador'] },
        { path: '/materials-dashboard', label: 'Materiais', icon: '', roles: ['Admin', 'Solicitante', 'Visualizador'] },
      ],
    },
    {
      id: 'requests',
      label: 'Solicitações de Compra',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/requests/new', label: 'Nova Solicitação', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/requests', label: 'Minhas Solicitações', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/requests/in-progress', label: 'Em andamento', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/requests/all', label: 'Todas as Solicitações', icon: '', roles: ['Admin', 'Visualizador'] },
      ],
    },
    {
      id: 'materials',
      label: 'Materiais',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/materials', label: 'Lista de Materiais', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/my-materials', label: 'Meus Materiais', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/materials/new', label: 'Cadastrar Material', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
      ],
    },
    {
      id: 'admin',
      label: 'Administração',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.125-1.274-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.125-1.274.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>',
      roles: ['Admin'],
      links: [
        { path: '/users', label: 'Usuários', icon: '', roles: ['Admin'] },
        { path: '/audit', label: 'Auditoria', icon: '', roles: ['Admin'] },
      ],
    },
    {
      id: 'apontamentos',
      label: 'Apontamentos',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>',
      roles: ['Admin'],
      links: [
        { path: '/apontamentos', label: 'Apontamentos', icon: '', roles: ['Admin'] },
      ],
    },
    {
      id: 'almoxarifado',
      label: 'Almoxarifado',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/almoxarifado/aguardando', label: 'Aguardando Retirada', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/almoxarifado/entradas',   label: 'Entradas por Período', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
        { path: '/almoxarifado/importar',   label: 'Importar Dados', icon: '', roles: ['Admin'] },
      ],
    },
    {
      id: 'estoque',
      label: 'Estoque de Segurança',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0v10l-8 4m0-10L4 7m8 4v10" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/safety-stock', label: 'Estoque de Segurança', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
      ],
    },
    {
      id: 'profile',
      label: 'Meu Perfil',
      icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      roles: ['Solicitante', 'Admin', 'Visualizador'],
      links: [
        { path: '/profile', label: 'Meu Perfil', icon: '', roles: ['Solicitante', 'Admin', 'Visualizador'] },
      ],
    },
  ];

  visibleNavGroups = computed(() => {
    const userRole = this.currentUser()?.role;
    if (!userRole) return [];

    return this.navGroups
      .filter(group => group.roles.includes(userRole))
      .map(group => ({
        ...group,
        links: group.links.filter(link => link.roles.includes(userRole)),
      }))
      .filter(group => group.links.length > 0);
  });

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
  }

  toggleGroup(groupId: string): void {
    this.expandedGroups.update(state => ({
      ...state,
      [groupId]: !state[groupId],
    }));
  }

  isGroupExpanded(group: NavGroup): boolean {
    const state = this.expandedGroups();
    return !!state[group.id];
  }

  isGroupActive(group: NavGroup): boolean {
    const cleanUrl = this.currentUrl().split('?')[0];
    return group.links.some(link => this.routeMatches(cleanUrl, link.path));
  }

  private routeMatches(currentUrl: string, path: string): boolean {
    if (currentUrl === path) return true;
    return currentUrl.startsWith(`${path}/`);
  }
}
