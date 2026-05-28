// Tipos que espelham as colunas brutas do banco de dados (Supabase/PostgreSQL).
// Usados apenas nas camadas de mapeamento dos services — nunca expor fora deles.

export interface PurchaseRequestRow {
  id: string;
  requester_id: string;
  material_code: string;
  description: string;
  quantity: number;
  unit: string;
  material_type: string;
  workorder: string | null;
  priority: string;
  justification: string | null;
  requestdate: string;
  status: string;
  history: unknown;
  supplier: string | null;
  unitvalue: number | null;
  totalvalue: number | null;
  approvedvalue: number | null;
  scnumber: string | null;
  responsiblebuyer: string | null;
  ordernumber: string | null;
  deliverydate: string | null;
  materialreceiveddate: string | null;
  internalnotes: string | null;
  portalapprovedby: string | null;
  portalapprovedat: string | null;
  mrpapprovedby: string | null;
  mrpapprovedat: string | null;
  rdapprovedby: string | null;
  rdapprovedat: string | null;
  finishedat: string | null;
  requester?: {
    id: string;
    name: string;
    email: string;
    role: string;
    department?: string;
    position?: string;
    must_change_password?: boolean;
  } | null;
}

export interface HistoryEventRaw {
  date?: unknown;
  user?: { id?: string; name?: string; role?: string };
  action?: string;
  details?: string;
}

export interface HistoryRow {
  id: string;
  request_id: string;
  user_id: string;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  created_at: string;
  profiles?: { name: string } | null;
}

export interface CommentRow {
  id: string;
  request_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  updated_at?: string | null;
  profiles?: { name: string } | null;
}

export interface MaterialRow {
  id: string;
  codigo: string | null;
  descricao_breve: string;
  descricao_detalhada: string;
  unidade: string;
  ncm: string | null;
  estoque_seguranca: boolean;
  qtd_estoque_seguranca: number | null;
  complementar: string | null;
  photo_url: string | null;
  datasheet_url: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

export interface ProfileRow {
  id: string;
  name: string;
  email: string;
  department: string | null;
  position: string | null;
  role: string;
  must_change_password: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  request_id: string | null;
  material_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RestError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}
