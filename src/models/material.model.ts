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
  released_at?: string | null;
}

/**
 * Liga/desliga o cadastro de novos materiais (bloqueado de 22/09 a 16/10/2026 durante a
 * migração para o SENIOR). Com `true`, o formulário, a Lista e Meus Materiais mostram o
 * aviso abaixo e o service recusa createMaterial — lembrar de tirar também o link
 * "Cadastrar Material" do menu (sidebar.component.ts).
 */
export const MATERIAL_CREATION_DISABLED = false;
export const MATERIAL_CREATION_DISABLED_MESSAGE =
  'O cadastro de novos materiais está desabilitado por conta da migração para o sistema SENIOR.';

export interface CreateMaterialRequest {
  codigo?: string | null;
  descricao_breve: string;
  descricao_detalhada: string;
  unidade: UnidadeMedida;
  ncm: string;
  estoque_seguranca?: boolean;
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
