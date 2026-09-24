import '@angular/compiler';
import { jest } from '@jest/globals';
import { NotificationService } from './notification.service';

afterEach(() => jest.useRealTimers());

it('o timer de uma mensagem antiga não apaga a mensagem nova antes da hora dela', () => {
  jest.useFakeTimers();
  const service = new NotificationService();

  service.show('primeira', 'success', 4000);
  jest.advanceTimersByTime(3000);
  service.show('segunda', 'warning', 4000);
  jest.advanceTimersByTime(1500); // 4,5 s desde a primeira; 1,5 s desde a segunda

  expect(service.notification()).toEqual({ message: 'segunda', type: 'warning' });
});

it('a mensagem nova some quando o tempo dela acaba', () => {
  jest.useFakeTimers();
  const service = new NotificationService();

  service.show('primeira', 'success', 4000);
  jest.advanceTimersByTime(3000);
  service.show('segunda', 'warning', 4000);
  jest.advanceTimersByTime(4000);

  expect(service.notification()).toBeNull();
});
