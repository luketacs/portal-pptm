// FCA de cada ordem "Sem OS" do cronograma de preventivas, antes do início do tratamento
// semanal (09/11/2026). Pedido do usuário em 11/11/2026: as ordens sem OS saem das abas de
// mês e vão para uma aba própria, cada uma com fato, causa e ação. Conferido no export do
// SIGMA (OS e apontamentos) em 11/11/2026, fechamento S45. Chave: `${codigo}|${data}`.
// Ordem sem OS que não está aqui sai com a causa em branco e status Pendente (o PCM preenche).
export interface FcaSemOs {
  fato: string;
  causa: string;
  acao: string;
  responsavel: string;
  prazo: string;
  status: string;
}

export const FCA_SEM_OS_HISTORICO: Readonly<Record<string, FcaSemOs>> = {
  "PM-0145|2026-10-05": {
    fato: "Sem OS programada na semana de 05/10/2026. As OS 046602 e 046603 do plano foram canceladas no SIGMA; a OS anterior (046601) foi apontada em 01/10/2026 e a seguinte (046604) em 23/10/2026.",
    causa: "OS preventivas do plano geradas no Protheus com data errada (046595 a 046604, todas com início em 17/01/2026); a semana ficou sem OS programada (FCA, causa 2).",
    acao: "Programar pela data do plano nesta planilha, a cada semana (FCA, ações 1 e 2).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0527|2026-10-05": {
    fato: "Sem execução na ocorrência mensal de 21/09/2026 (período até 20/10/2026), durante a parada. As OS 042177 a 042184 (8 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048093, apontada em 22/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "22/10/2026", status: "Concluída",
  },
  "PM-0601|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 035723 a 035726 (4 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048360, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0629|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 015663 a 015669 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048346, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0649|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 044724 a 044730 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048356, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0676|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 040530 a 040533 (4 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048421, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0683|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 014369 a 014375 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048419, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0707|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 013813 a 013819 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048355, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0718|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. Nenhuma OS do plano foi programada ou apontada nesse período.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048077, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0739|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. Nenhuma OS do plano foi programada ou apontada nesse período.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048071, apontada em 27/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "27/10/2026", status: "Concluída",
  },
  "PM-0761|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 016508 a 016514 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048358, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0765|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 016690 a 016692 (3 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048357, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0821|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. Nenhuma OS do plano foi programada ou apontada nesse período.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048076, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0837|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 017554 a 017557 (4 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048080, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0848|2026-10-08": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 017842 a 017848 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048420, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0620|2026-10-10": {
    fato: "Sem execução na ocorrência mensal de 19/09/2026 (período até 18/10/2026), durante a parada. As OS 015807 a 015812 (6 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 015784, apontada em 19/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "19/10/2026", status: "Concluída",
  },
  "PM-0686|2026-10-10": {
    fato: "Sem execução na ocorrência mensal de 19/09/2026 (período até 18/10/2026), durante a parada. As OS 042452 a 042458 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048251, apontada em 21/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "21/10/2026", status: "Concluída",
  },
  "PM-0745|2026-10-10": {
    fato: "Sem execução na ocorrência mensal de 19/09/2026 (período até 18/10/2026), durante a parada. As OS 041448 a 041454 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048056, apontada em 21/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "21/10/2026", status: "Concluída",
  },
  "PM-0886|2026-10-10": {
    fato: "Sem execução na ocorrência mensal de 19/09/2026 (período até 18/10/2026), durante a parada. Nenhuma OS do plano foi programada ou apontada nesse período.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048022, apontada em 21/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "21/10/2026", status: "Concluída",
  },
  "PM-0651|2026-10-11": {
    fato: "Sem execução na ocorrência mensal de 20/09/2026 (período até 19/10/2026), durante a parada. As OS 044357 a 044363 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048252, apontada em 21/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "21/10/2026", status: "Concluída",
  },
  "PM-0690|2026-10-11": {
    fato: "Sem execução na ocorrência mensal de 20/09/2026 (período até 19/10/2026), durante a parada. As OS 041049 a 041056 (8 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048057, apontada em 21/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "21/10/2026", status: "Concluída",
  },
  "PM-0145|2026-10-12": {
    fato: "Sem OS programada na semana de 12/10/2026. As OS 046602 e 046603 do plano foram canceladas no SIGMA; a OS anterior (046601) foi apontada em 01/10/2026 e a seguinte (046604) em 23/10/2026.",
    causa: "OS preventivas do plano geradas no Protheus com data errada (046595 a 046604, todas com início em 17/01/2026); a semana ficou sem OS programada (FCA, causa 2).",
    acao: "Programar pela data do plano nesta planilha, a cada semana (FCA, ações 1 e 2).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0527|2026-10-12": {
    fato: "Sem execução na ocorrência mensal de 21/09/2026 (período até 20/10/2026), durante a parada. As OS 042177 a 042184 (8 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048093, apontada em 22/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "22/10/2026", status: "Concluída",
  },
  "PM-0764|2026-10-14": {
    fato: "Sem execução na ocorrência mensal de 16/09/2026 (período até 15/10/2026), durante a parada. As OS 016630 a 016635 (6 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Programar a OS 016637 na semana 47 (16/11/2026) e manter a inspeção mensal enquanto durar a parada.",
    responsavel: 'PCM', prazo: "16/11/2026", status: "Pendente",
  },
  "PM-0629|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 015663 a 015669 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048346, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0649|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 044724 a 044730 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048356, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0683|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 014369 a 014375 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048419, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0707|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 013813 a 013819 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048355, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0739|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. Nenhuma OS do plano foi programada ou apontada nesse período.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048071, apontada em 27/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "27/10/2026", status: "Concluída",
  },
  "PM-0761|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 016508 a 016514 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048358, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0848|2026-10-15": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 017842 a 017848 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048420, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0764|2026-10-21": {
    fato: "Sem execução na ocorrência mensal de 16/10/2026 (período até 15/11/2026), durante a parada. As OS 016633 a 016636 (4 OS) foram canceladas no SIGMA e as OS 016637, 016638 e 016639 seguem pendentes, sem apontamento.",
    causa: "A OS da ocorrência mensal (016637) não foi programada; as OS semanais do plano seguiram canceladas.",
    acao: "Programar a OS 016637 na semana 47 (16/11/2026) e manter a inspeção mensal enquanto durar a parada.",
    responsavel: 'PCM', prazo: "16/11/2026", status: "Pendente",
  },
  "PM-0629|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 015663 a 015669 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048346, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0649|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 044724 a 044730 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048356, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0683|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 014369 a 014375 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048419, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0707|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 013813 a 013819 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048355, apontada em 29/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "29/10/2026", status: "Concluída",
  },
  "PM-0761|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 016508 a 016514 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048358, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0848|2026-10-22": {
    fato: "Sem execução na ocorrência mensal de 27/09/2026 (período até 26/10/2026), durante a parada. As OS 017842 a 017848 (7 OS) foram canceladas no SIGMA, sem apontamento.",
    causa: "Entrada da parada da planta: as OS semanais e quinzenais foram canceladas sem programar a inspeção mensal que as substitui durante a parada (FCA, causa 3).",
    acao: "Inspeção retomada pela OS 048420, apontada em 30/10/2026. A mensal passou a ser programada desde a primeira semana da parada (FCA, ação 3).",
    responsavel: 'PCM', prazo: "30/10/2026", status: "Concluída",
  },
  "PM-0713|2026-10-26": {
    fato: "Ocorrência mensal de 19/10/2026 (parada) atendida pela OS 011285, apontada em 23/10/2026 e cancelada depois no SIGMA. OS cancelada não sustenta a dispensa da parada, e a linha fica sem OS.",
    causa: "OS cancelada no SIGMA depois do apontamento.",
    acao: "Execução de 23/10/2026 registrada nesta FCA. As ocorrências seguintes têm OS própria; OS já apontada não deve ser cancelada.",
    responsavel: 'PCM', prazo: "09/11/2026", status: "Concluída",
  },
  "PM-0194|2026-10-28": {
    fato: "Plano com data inicial em 28/10/2026 sem nenhuma OS gerada no Protheus com a descrição do plano.",
    causa: "OS preventiva não gerada pelo Protheus (FCA, causa 2).",
    acao: "Gerar a OS do plano antes da próxima ocorrência, em 28/04/2027.",
    responsavel: 'PCM', prazo: "28/04/2027", status: "Pendente",
  },
  "PM-0764|2026-10-28": {
    fato: "Sem execução na ocorrência mensal de 16/10/2026 (período até 15/11/2026), durante a parada. As OS 016633 a 016636 (4 OS) foram canceladas no SIGMA e as OS 016637, 016638 e 016639 seguem pendentes, sem apontamento.",
    causa: "A OS da ocorrência mensal (016637) não foi programada; as OS semanais do plano seguiram canceladas.",
    acao: "Programar a OS 016637 na semana 47 (16/11/2026) e manter a inspeção mensal enquanto durar a parada.",
    responsavel: 'PCM', prazo: "16/11/2026", status: "Pendente",
  },
  "PM-0867|2026-11-01": {
    fato: "Ocorrência mensal de 20/10/2026 (parada) atendida pela OS 006848, apontada em 19/10/2026 e cancelada depois no SIGMA. OS cancelada não sustenta a dispensa da parada, e a linha fica sem OS.",
    causa: "OS cancelada no SIGMA depois do apontamento.",
    acao: "Execução de 19/10/2026 registrada nesta FCA. As ocorrências seguintes têm OS própria; OS já apontada não deve ser cancelada.",
    responsavel: 'PCM', prazo: "09/11/2026", status: "Concluída",
  },
  "PM-0713|2026-11-02": {
    fato: "Ocorrência mensal de 19/10/2026 (parada) atendida pela OS 011285, apontada em 23/10/2026 e cancelada depois no SIGMA. OS cancelada não sustenta a dispensa da parada, e a linha fica sem OS.",
    causa: "OS cancelada no SIGMA depois do apontamento.",
    acao: "Execução de 23/10/2026 registrada nesta FCA. As ocorrências seguintes têm OS própria; OS já apontada não deve ser cancelada.",
    responsavel: 'PCM', prazo: "09/11/2026", status: "Concluída",
  },
  "PM-0764|2026-11-04": {
    fato: "Sem execução na ocorrência mensal de 16/10/2026 (período até 15/11/2026), durante a parada. As OS 016633 a 016636 (4 OS) foram canceladas no SIGMA e as OS 016637, 016638 e 016639 seguem pendentes, sem apontamento.",
    causa: "A OS da ocorrência mensal (016637) não foi programada; as OS semanais do plano seguiram canceladas.",
    acao: "Programar a OS 016637 na semana 47 (16/11/2026) e manter a inspeção mensal enquanto durar a parada.",
    responsavel: 'PCM', prazo: "16/11/2026", status: "Pendente",
  },
};
