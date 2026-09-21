/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@angular/compiler';
import { signal, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { MaterialsDashboardComponent } from './materials-dashboard.component';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

it('cria o efeito após carregar materiais sem perder o contexto de injeção', async () => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const component = TestBed.runInInjectionContext(() => new MaterialsDashboardComponent(
    { getAllMaterials: async () => ({ data: [], error: null }) } as any,
    { requests: signal([]) } as any, {} as any,
  ));
  // Executado fora do contexto de construção, como ocorre após await em ngOnInit.
  await expect(component.ngOnInit()).resolves.toBeUndefined();
  expect(component.isLoading()).toBe(false);
  TestBed.tick();
  component.ngOnDestroy();
});
