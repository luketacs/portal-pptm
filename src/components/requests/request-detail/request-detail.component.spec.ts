import '@angular/compiler';
import { signal } from '@angular/core';
import { jest } from '@jest/globals';
import { RequestDetailComponent } from './request-detail.component';

it('aguarda salvar o valor antes de aprovar em RD e bloqueia clique repetido', async () => {
  let concluir!: () => void;
  const gravacao = new Promise<void>(resolve => { concluir = resolve; });
  const updateRequest = jest.fn(() => gravacao);
  const updateRequestStatus = jest.fn(async () => {});
  const controller = Object.assign(Object.create(RequestDetailComponent.prototype), {
    request: signal({ id: 'pedido' }), currentUser: signal({ id: 'admin' }),
    isAdmin: () => true, isApprovingRD: signal(false), editableRequest: signal({ approvedValue: 100 }),
    requestService: { updateRequest, updateRequestStatus }, refreshRequest: jest.fn(),
    notificationService: { showSuccess: jest.fn(), showError: jest.fn() },
  }) as RequestDetailComponent;
  const saving = controller.approveRD();
  await controller.approveRD();
  expect(updateRequest).toHaveBeenCalledTimes(1);
  expect(updateRequestStatus).not.toHaveBeenCalled();
  concluir();
  await saving;
  expect(updateRequestStatus).toHaveBeenCalledWith('pedido', 'Aprovado em RD', { id: 'admin' });
  expect(controller.isApprovingRD()).toBe(false);
});
