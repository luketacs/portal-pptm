import '@angular/compiler';
import { signal } from '@angular/core';
import { MyMaterialsComponent } from './my-materials.component';
import { PurchaseRequest } from '../../../models/request.model';

it('atualiza as solicitações relacionadas mesmo quando chegam depois dos materiais', async () => {
  const requests = signal<PurchaseRequest[]>([]);
  const component = new MyMaterialsComponent(
    { getAllMaterials: async () => ({ data: [{ codigo: '123', created_by: 'user' }], error: null }) } as any,
    { requests } as any, { currentUser: () => ({ id: 'user' }) } as any, {} as any,
  );
  await component.ngOnInit();
  expect(component.rows()[0].hasAnyRequest).toBe(false);
  requests.set([{ materialCode: '123', status: 'Pendente', requestDate: new Date() } as PurchaseRequest]);
  expect(component.rows()[0].hasOpenRequest).toBe(true);
  requests.set([]);
  expect(component.rows()[0].hasAnyRequest).toBe(false);
});
