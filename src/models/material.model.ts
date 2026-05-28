// ============================================
// Interfaces para consulta de Material via API Externa
// ============================================
export interface MaterialApiResponse {
  success: boolean;
  data: MaterialData | null;
  error?: string | null;
}

export interface MaterialData {
  id: number;
  texto_breve: string;
  texto_completo: string;
  tipo: string; // "MC", "EL", etc.
  unidade: string;
  ncm: string;
  codigo_grupo: string;
  estoques: StockInfo[];
}

export interface StockInfo {
  empresa: string;
  codigo: string;
  localizacao: string;
  descricao: string;
  qAtual: string; // Quantity is a string in the API response
  qEmpenhada: string;
}

// ============================================
// Interfaces para Cadastro Interno de Materiais (Supabase)
// ============================================

export type UnidadeMedida = 'UN' | 'KG' | 'CX' | 'MT' | 'LT' | 'M²' | 'M³' | 'PC' | 'KIT';

export type StatusMaterial = 'pendente' | 'liberado';

export interface Material {
  id?: string;
  codigo?: string | null;
  descricao_breve: string;
  descricao_detalhada: string;
  unidade: UnidadeMedida;
  ncm: string;
  estoque_seguranca: boolean;
  qtd_estoque_seguranca?: number | null;
  complementar?: string | null;
  photo_url?: string | null;
  datasheet_url?: string | null;
  status?: StatusMaterial;
  created_by?: string;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateMaterialRequest {
  codigo?: string | null;
  descricao_breve: string;
  descricao_detalhada: string;
  unidade: UnidadeMedida;
  ncm: string;
  estoque_seguranca: boolean;
  qtd_estoque_seguranca?: number | null;
  complementar?: string | null;
  photo_url?: string | null;
  datasheet_url?: string | null;
  status?: StatusMaterial;
}

export interface MaterialFormData {
  codigo: string;
  descricao_breve: string;
  descricao_detalhada: string; // OBRIGATÓRIO
  unidade: UnidadeMedida;
  ncm: string;
  estoque_seguranca: boolean;
  qtd_estoque_seguranca: number | null;
  complementar: string;
}
