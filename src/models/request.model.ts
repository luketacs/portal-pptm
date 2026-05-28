import { UserProfile } from './user.model';

export type RequestStatus = 'Pendente' | 'Aprovado no Portal' | 'Reprovado' | 'Aprovado no MRP' | 'SC Criada' | 'Em Cotação' | 'Aprovado em RD' | 'Reprovado em RD' | 'Pedido Criado' | 'Material Recebido' | 'Finalizado';
export type MaterialType = 'Mecânica' | 'Elétrica' | 'SPCI' | 'Refrigeração' | 'Outros';
export type Priority = 'Baixa' | 'Média' | 'Alta' | 'Emergencial';

export interface HistoryEvent {
  date: Date;
  // Store a subset of user data to avoid huge objects in the JSONB column
  user: { id: string; name: string; role: string; };
  action: string;
  details?: string;
}

export interface PurchaseRequest {
  id: string; // This will be a UUID from Supabase
  requester: UserProfile; // This will be a joined object from Supabase
  materialCode: string;
  description: string;
  quantity: number;
  unit: string;
  materialType: MaterialType;
  workOrder: string;
  priority: Priority;
  justification: string;
  requestDate: Date;
  status: RequestStatus;
  history: HistoryEvent[];
  supplier?: string;
  unitValue?: number;
  totalValue?: number;
  approvedValue?: number; // Valor aprovado do material (obrigatório para Aprovado em RD)
  scNumber?: string;
  responsibleBuyer?: string;
  orderNumber?: string;
  deliveryDate?: Date;
  materialReceivedDate?: Date; // Data de confirmação de recebimento
  internalNotes?: string;
  // Campos de auditoria
  portalApprovedBy?: string; // ID do usuário que aprovou no portal
  portalApprovedAt?: Date;
  mrpApprovedBy?: string; // Usuário que aprovou no MRP
  mrpApprovedAt?: Date;
  rdApprovedBy?: string;
  rdApprovedAt?: Date;
  finishedAt?: Date;
}



