import '@angular/compiler';
import { FormBuilder } from '@angular/forms';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { jest } from '@jest/globals';
import { RequestFormComponent } from './request-form.component';

afterEach(() => jest.useRealTimers());

it('bloqueia envio durante consulta e descarta resposta do código anterior', async () => {
  jest.useFakeTimers();
  const anterior = new Subject<any>();
  const atual = new Subject<any>();
  const component = new RequestFormComponent(new FormBuilder(), {} as any,
    { getOpenRequestsByMaterialCode: () => [] } as any,
    { currentUser: signal({ id: 'user' }) } as any, {} as any,
    { getMaterialByCode: (code: string) => code === '1' ? anterior : atual } as any,
    { users: signal([]) } as any,
  );
  const code = component.items().at(0).get('materialCode')!;
  code.setValue('1');
  expect(component.materialsReady()).toBe(false);
  await jest.advanceTimersByTimeAsync(500);
  code.setValue('2');
  anterior.next({ success: true, data: { texto_breve: 'Antigo', estoques: [] } });
  expect(component.items().at(0).get('description')!.value).toBe('');
  expect(component.materialsReady()).toBe(false);
  await jest.advanceTimersByTimeAsync(500);
  atual.next({ success: true, data: { texto_breve: 'Atual', tipo: 'MC', unidade: 'UN', estoques: [] } });
  expect(component.materialsReady()).toBe(true);
  expect(component.items().at(0).get('description')!.value).toBe('Atual');
  component.ngOnDestroy();
});
