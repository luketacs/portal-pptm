import { mapRequestFromDb, normalizeMaterialType, parseHistoryDate } from './request-mapper';
import type { PurchaseRequestRow } from '../models/database.types';

const BASE_ROW: PurchaseRequestRow = {
  id: 'abc-123',
  requester_id: 'user-1',
  material_code: 'MTR-001',
  description: 'Parafuso M8',
  quantity: 10,
  unit: 'UN',
  material_type: 'Mecânica',
  workorder: 'OS-999',
  priority: 'Alta',
  justification: 'Urgente',
  requestdate: '2024-06-01T10:00:00Z',
  status: 'Pendente',
  history: [],
  supplier: null,
  unitvalue: null,
  totalvalue: null,
  approvedvalue: null,
  scnumber: null,
  responsiblebuyer: null,
  ordernumber: null,
  deliverydate: null,
  materialreceiveddate: null,
  internalnotes: null,
  portalapprovedby: null,
  portalapprovedat: null,
  mrpapprovedby: null,
  mrpapprovedat: null,
  rdapprovedby: null,
  rdapprovedat: null,
  finishedat: null,
  requester: { id: 'user-1', name: 'João', email: 'joao@example.com', role: 'Solicitante' },
};

describe('mapRequestFromDb', () => {
  it('mapeia campos básicos corretamente', () => {
    const result = mapRequestFromDb(BASE_ROW);
    expect(result.id).toBe('abc-123');
    expect(result.materialCode).toBe('MTR-001');
    expect(result.description).toBe('Parafuso M8');
    expect(result.quantity).toBe(10);
    expect(result.status).toBe('Pendente');
    expect(result.priority).toBe('Alta');
  });

  it('popula requester a partir do join', () => {
    const result = mapRequestFromDb(BASE_ROW);
    expect(result.requester.id).toBe('user-1');
    expect(result.requester.name).toBe('João');
    expect(result.requester.role).toBe('Solicitante');
  });

  it('usa requester_id como fallback quando join não retorna dados', () => {
    const row = { ...BASE_ROW, requester: null };
    const result = mapRequestFromDb(row);
    expect(result.requester.id).toBe('user-1');
    expect(result.requester.name).toBe('Solicitante não identificado');
  });

  it('converte null para undefined nos campos opcionais', () => {
    const result = mapRequestFromDb(BASE_ROW);
    expect(result.supplier).toBeUndefined();
    expect(result.unitValue).toBeUndefined();
    expect(result.scNumber).toBeUndefined();
    expect(result.deliveryDate).toBeUndefined();
  });

  it('converte datas de string para Date', () => {
    const result = mapRequestFromDb(BASE_ROW);
    expect(result.requestDate).toBeInstanceOf(Date);
    expect(result.requestDate.getFullYear()).toBe(2024);
  });

  it('parseia datas de entrega quando presentes', () => {
    const row = { ...BASE_ROW, deliverydate: '2024-12-31T00:00:00Z' };
    const result = mapRequestFromDb(row);
    expect(result.deliveryDate).toBeInstanceOf(Date);
    expect(result.deliveryDate?.getFullYear()).toBe(2024);
  });

  it('parseia histórico corretamente', () => {
    const row = {
      ...BASE_ROW,
      history: [
        { date: '2024-06-01T10:00:00Z', user: { id: 'u1', name: 'Admin', role: 'Admin' }, action: 'Criação', details: 'Teste' },
      ],
    };
    const result = mapRequestFromDb(row);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].action).toBe('Criação');
    expect(result.history[0].user.name).toBe('Admin');
    expect(result.history[0].date).toBeInstanceOf(Date);
  });
});

describe('normalizeMaterialType', () => {
  it.each([
    ['Mecânica', 'Mecânica'],
    ['mecanica', 'Mecânica'],
    ['MECANICA', 'Mecânica'],
    ['Elétrica', 'Elétrica'],
    ['eletrica', 'Elétrica'],
    ['Refrigeração', 'Refrigeração'],
    ['refrigeracao', 'Refrigeração'],
    ['SPCI', 'SPCI'],
    ['spci', 'SPCI'],
    ['Outro tipo', 'Outros'],
    ['', 'Outros'],
  ])('normaliza "%s" para "%s"', (input, expected) => {
    expect(normalizeMaterialType(input)).toBe(expected);
  });
});

describe('parseHistoryDate', () => {
  it('retorna null para valores falsy', () => {
    expect(parseHistoryDate(null)).toBeNull();
    expect(parseHistoryDate('')).toBeNull();
    expect(parseHistoryDate(undefined)).toBeNull();
  });

  it('parseia datas no formato ISO', () => {
    const result = parseHistoryDate('2024-06-15T12:30:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result?.getUTCFullYear()).toBe(2024);
  });

  it('parseia datas no formato dd/MM/yyyy', () => {
    const result = parseHistoryDate('15/06/2024');
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(5); // junho = índice 5
    expect(result?.getDate()).toBe(15);
  });

  it('parseia datas no formato dd/MM/yyyy HH:mm:ss', () => {
    const result = parseHistoryDate('15/06/2024 14:30:00');
    expect(result).toBeInstanceOf(Date);
    expect(result?.getHours()).toBe(14);
    expect(result?.getMinutes()).toBe(30);
  });

  it('retorna o próprio Date se já for uma instância válida', () => {
    const date = new Date('2024-01-01');
    expect(parseHistoryDate(date)).toBe(date);
  });
});
