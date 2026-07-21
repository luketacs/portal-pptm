import { Signal, WritableSignal, computed, signal } from '@angular/core';

export interface PageNavigation {
  currentPage: WritableSignal<number>;
  pageSize: number;
  totalPages: Signal<number>;
  startItem: Signal<number>;
  endItem: Signal<number>;
  visiblePages: Signal<number[]>;
  goToPage(page: number): void;
}

// Navegação de paginação (total de páginas, janela de páginas visíveis, item inicial/final).
// Serve tanto para listas paginadas no cliente (fatiando um array já carregado — ver
// createClientPageItems) quanto no servidor (total vindo de uma consulta com count).
export function createPageNavigation(totalItems: Signal<number>, pageSize: number): PageNavigation {
  const currentPage = signal(1);

  const totalPages = computed(() => Math.ceil(totalItems() / pageSize) || 1);
  const startItem = computed(() => totalItems() === 0 ? 0 : (currentPage() - 1) * pageSize + 1);
  const endItem = computed(() => Math.min(currentPage() * pageSize, totalItems()));

  const visiblePages = computed(() => {
    const total = totalPages();
    const current = currentPage();
    const pages: number[] = [];
    for (let i = Math.max(1, current - 2); i <= Math.min(total, current + 2); i++) pages.push(i);
    return pages;
  });

  function goToPage(page: number): void {
    if (page >= 1 && page <= totalPages()) currentPage.set(page);
  }

  return { currentPage, pageSize, totalPages, startItem, endItem, visiblePages, goToPage };
}

// Fatia um array já carregado no cliente conforme a página atual de `nav`.
export function createClientPageItems<T>(items: Signal<T[]>, nav: PageNavigation): Signal<T[]> {
  return computed(() => {
    const all = items();
    const page = Math.min(nav.currentPage(), nav.totalPages());
    const start = (page - 1) * nav.pageSize;
    return all.slice(start, start + nav.pageSize);
  });
}
