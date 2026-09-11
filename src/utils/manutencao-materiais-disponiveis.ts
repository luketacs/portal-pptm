// "Materiais disponíveis pra execução" — cruza o que o Almoxarifado já marca como
// "aguardando retirada" (material chegou no estoque, ninguém retirou ainda) com o
// número de OS de cada solicitação, pra saber quais OS's inteiras já têm TODO o
// material necessário disponível (não só uma parte). O cálculo em si (FIFO,
// parcial/não-parcial por material) já existe em
// AlmoxarifadoService.calcularAguardandoRetirada — esta função só faz o passo
// seguinte: agrupar por OS e decidir quais estão 100% prontas.
import type { MaterialComSAs, Solicitacao } from '../services/almoxarifado.service';

export interface OrdemComMaterialDisponivel {
  numeroOs: string; // já normalizado (ver normalizarNumeroOs, passado como parâmetro)
  materiais: string[]; // descrições dos materiais que chegaram pra essa OS, sem repetir
}

// Uma OS só entra na lista quando TODAS as solicitações (SAs) dela — em qualquer
// material — estão com o item disponível e não-parcial. Uma única SA parcial (ou um
// material que nem apareceu no resultado do FIFO porque ainda não chegou nada dele)
// já tira a OS inteira da lista — decisão do usuário: só mostrar quando 100% pronta,
// não "parcialmente pronta".
export function ordensComMaterialTotalmenteDisponivel(
  sasAbertas: Solicitacao[],
  comSA: MaterialComSAs[],
  normalizarNumeroOs: (v: string) => string,
): OrdemComMaterialDisponivel[] {
  const infoPorSaId = new Map<string, { pronta: boolean; produtoDesc: string }>();
  for (const item of comSA) {
    for (const sa of item.sas) {
      infoPorSaId.set(sa.id, { pronta: !sa.parcial, produtoDesc: item.material.produto_desc });
    }
  }

  const porOrdem = new Map<string, Solicitacao[]>();
  for (const sa of sasAbertas) {
    const ordemRaw = (sa.ordem_id || '').trim();
    if (!ordemRaw) continue;
    const lista = porOrdem.get(ordemRaw) ?? [];
    lista.push(sa);
    porOrdem.set(ordemRaw, lista);
  }

  const resultado: OrdemComMaterialDisponivel[] = [];
  for (const [ordemRaw, lista] of porOrdem) {
    const todasProntas = lista.every(sa => infoPorSaId.get(sa.id)?.pronta === true);
    if (!todasProntas) continue;
    const materiais = [...new Set(
      lista.map(sa => infoPorSaId.get(sa.id)?.produtoDesc).filter((d): d is string => !!d),
    )];
    resultado.push({ numeroOs: normalizarNumeroOs(ordemRaw), materiais });
  }
  return resultado.sort((a, b) => a.numeroOs.localeCompare(b.numeroOs));
}
