import { Injectable, signal } from '@angular/core';

/** Estado do layout compartilhado entre header e sidebar (gaveta do menu no celular). */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarOpen = signal(false);

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
