import { ReparoGarantia, ReparoStatus } from '../models/eletrica-reparo.model';

// Número do chamado como as pessoas falam: 7 → "RE-007". Precisa ficar em sincronia com
// numeroReparo em api/_eletrica-reparo-teams-shared.js
export function numeroReparo(numero: number | null | undefined): string {
  return numero ? `RE-${String(numero).padStart(3, '0')}` : '';
}

// Na ordem do andamento normal — é a ordem dos filtros e do seletor do supervisor.
export const REPARO_STATUS: ReparoStatus[] = [
  'aberto', 'em_analise', 'aguardando_orcamento', 'orcamento_recebido',
  'em_reparo', 'disponivel_teste', 'concluido', 'reparo_inviavel', 'cancelado',
];

export const REPARO_STATUS_LABEL: Record<ReparoStatus, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  aguardando_orcamento: 'Aguardando orçamento',
  orcamento_recebido: 'Orçamento recebido',
  em_reparo: 'Em reparo',
  disponivel_teste: 'Disponível para teste em campo',
  concluido: 'Concluído',
  reparo_inviavel: 'Reparo inviável',
  cancelado: 'Cancelado',
};

export const REPARO_STATUS_BADGE: Record<ReparoStatus, string> = {
  aberto: 'bg-blue-100 text-blue-800',
  em_analise: 'bg-indigo-100 text-indigo-800',
  aguardando_orcamento: 'bg-amber-100 text-amber-800',
  orcamento_recebido: 'bg-orange-100 text-orange-800',
  em_reparo: 'bg-purple-100 text-purple-800',
  disponivel_teste: 'bg-teal-100 text-teal-800',
  concluido: 'bg-green-100 text-green-800',
  reparo_inviavel: 'bg-red-100 text-red-800',
  cancelado: 'bg-gray-200 text-gray-700',
};

// Encerrados saem da visão "Em andamento" do controle.
export function reparoEncerrado(status: ReparoStatus): boolean {
  return status === 'concluido' || status === 'reparo_inviavel' || status === 'cancelado';
}

export const REPARO_GARANTIA_LABEL: Record<ReparoGarantia, string> = {
  vigente: 'Vigente',
  expirada: 'Expirada',
  nao_sei: 'Não informada',
};

// Itens do item 4 do relatório original — viram checklist no formulário.
export const REPARO_VERIFICACOES_PADRAO: string[] = [
  'Verificação da alimentação (tensão de entrada e fusíveis).',
  'Inspeção visual (conectores, cabos, sinais de aquecimento ou oxidação).',
  'Tentativa de reinicialização / reset.',
  'Teste do equipamento em outra condição de alimentação.',
];

// Legendas das fotos que o relatório original pede (item 8).
export const REPARO_FOTOS_PADRAO: string[] = [
  'Placa de identificação',
  'Vista frontal',
  'Vista posterior',
  'Vista lateral 1',
  'Vista lateral 2',
  'Vista inferior',
];

export const REPARO_SERVICO_PADRAO =
  'Diagnóstico e reparo do equipamento. Solicita-se orçamento prévio e laudo técnico com a causa raiz ' +
  'identificada, indicando viabilidade do reparo ou a substituição do equipamento.';

export const REPARO_ENDERECO = 'CE 085, s/n, km 40,5 (Complexo termoelétrico do Pecém)';

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sem passar por Date (evita voltar um dia por fuso).
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

// Foto de celular chega com 3–8 MB; reduz pra no máx. 1600px em JPEG antes de subir —
// senão o PDF com 6 fotos fica enorme e lento pra abrir no Teams.
export async function comprimirImagem(file: File, maxLado = 1600, qualidade = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem.'))), 'image/jpeg', qualidade));
}
