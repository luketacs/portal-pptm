# Correções da análise do Portal PPTM — 21/09/2026

Implementação local. As migrations ainda precisam ser aplicadas no Supabase e a aplicação/API precisa ser publicada para que as mudanças tenham efeito em produção.

## Problemas tratados

| Problema | Correção |
| --- | --- |
| Papéis restritos apenas pela interface | Migration 054 substitui políticas permissivas de fundo fixo, programação, planos, cadastros de manutenção, apontamentos e metas. Triggers protegem campos administrativos de solicitações/perfis. |
| API de apontamentos sem autenticação obrigatória | `/api/apontamentos` rejeita requisição sem token; mantém validação de token pelo Supabase. |
| Afastamentos individuais no painel público | Férias, atestados e lançamentos individuais de folga/exame permanecem no servidor. API retorna disponibilidade semanal e contagens agregadas para os indicadores. |
| Importação com exclusão antes de inserir | RPCs da migration 055 executam substituição e log em uma transação, com lock por tabela e rollback integral. Arquivo vazio não apaga a base. |
| Importação parcial de apontamentos apagando o ano inteiro | Substitui somente os dias presentes no arquivo. O arquivo precisa conter todos os apontamentos dos dias que substitui. |
| Dashboard de materiais com NG0203 | Efeito criado com injector explícito após a busca; evita criar efeito após destruir o componente. |
| Aprovação em RD usando valor anterior | Aguarda persistir o valor antes de validar/aprovar o status e bloqueia clique repetido. |
| Mesma OS em semanas diferentes agrupada em uma ocorrência | Agrupamento por semana e número de OS, preservando a consolidação entre técnicos da mesma semana. HH apontado também considera ambas as semanas. |
| Recuperação PKCE dependia de token no hash | Valida sessão e evento PASSWORD_RECOVERY do SDK. Não aceita login comum como recuperação e não oculta falha de atualização do perfil. |
| Autenticação/requisições podiam ficar em espera ou retry indefinido | Timeout nas consultas de autenticação e bootstrap; callback de auth não aguarda o SDK sob lock; paginação tenta renovar uma única vez em 401 e não renova em 403. |
| Listagens truncadas no limite do Supabase | Paginação de fundo fixo, planos, ciclos, programação, indicadores, afastamentos e APIs, inclusive com limite de servidor inferior a 1.000. Erro não retorna lista parcial como completa. |
| Próximas datas divergentes nas telas de manutenção | Cadastro e programação usam a mesma agenda: cadência fixa, parada, alinhamento por equipamento e primeira semana aberta. |
| Reprogramação ignorava novos impedimentos | Recarrega agenda/afastamentos/semanas fechadas e valida férias, atestado, folga, duplicidade e dias dentro da semana de destino. |
| Ordem gravada sem ciclo ou ciclo antigo após trocar plano | Migration 057 mantém vínculo/ciclo na transação da ordem; troca, desvinculação, exclusão e recálculo são tratados no banco. Remove ciclos vinculados a uma ordem cujo plano já havia mudado. |
| Atualização periódica consultava apenas o SIGMA | Atualiza também programação, afastamentos e indicadores persistidos. |
| HH total incluía pessoas já inativas | Aplica as datas de inativação tanto no total quanto no detalhamento. |
| Kanban com estado “hoje” dependente de curto-circuito | Separa a verificação de hoje da verificação de execução. Usa cadastro atual de planos e ledger de ciclos. |
| Saídas mensais incluíam entradas | Conta apenas movimentos com saída positiva. |
| Custo/saldo mais recente sobrescrito por movimento antigo | Agregação usa a data mais recente, independentemente da ordem do arquivo. |
| Filtros de data deslocavam o dia em UTC−3 | Datas civis são interpretadas à meia-noite local. |
| Solicitação enviada com descrição pendente ou resposta antiga | Bloqueia envio durante consulta/erro/descrição vazia e cancela imediatamente a consulta anterior ao trocar o código. |
| Retry da criação duplicava solicitações | UUID criado antes das tentativas; conflito só é aceito após confirmar que o mesmo ID já existe. |
| “Meus materiais” não acompanhava chegada das solicitações | Cruzamento computado reativamente a partir do signal de solicitações. |
| Tempo de liberação mudava após qualquer edição | Migration 056 registra `released_at` na transição de status. Não inventa data de liberação para registros históricos. |
| Build podia usar configuração de desenvolvimento | Build padrão agora seleciona produção explicitamente; servidor de desenvolvimento tem configuração própria. |
| Dependências de exportação carregadas ao abrir o módulo | ExcelJS e JSZip passam a ser importados ao exportar. CommonJS está declarado como dependência intencional no build. |
| Ausência de regressões de fluxos e banco | Adicionados testes de serviços/componentes, API e PostgreSQL local, comandos `test:all` e workflow de CI. README e configuração de exemplo atualizados. |

A regra de saldo do fundo fixo que reserva despesas antes da marcação de reembolso foi preservada: os testes e o cálculo existente tratam esse comportamento como regra do negócio.

## Implantação

Pré-requisito: banco existente com a evolução até 053 e as tabelas legadas. As fixtures do teste não devem ser usadas para criar ou sobrescrever produção. Migrations antigas incluem cargas e resets; não as execute novamente para aplicar esta correção.

1. Validar as quatro migrations novas em uma cópia de homologação do esquema atual. Manter backup antes da alteração do banco operacional.
2. Aplicar **054**, **055**, **056** e **057**, nessa ordem, uma vez cada, pelo fluxo de migrations do projeto ou SQL Editor do Supabase. Cada arquivo tem sua própria transação.
3. Publicar a aplicação e todas as funções de `api/` da mesma versão. As importações novas dependem das RPCs, e programação/material dependem das colunas/triggers novos. O formato de disponibilidade pública exige atualização conjunta de API e interface.
4. Configurar as variáveis de servidor e conferir as URLs permitidas de recuperação `/reset-password` no Supabase.
5. Executar [verificação do banco](../supabase/checks/2026_09_21_verificacao.sql), que contém apenas consultas.
6. Em homologação, conferir os fluxos com Admin, Solicitante e Visualizador, uma importação real de cada formato, um link real de recuperação e as exportações de Excel/ZIP.

A migration 057 passa a manter ciclos pela programação. Versões antigas do frontend que tentem gravar diretamente o ledger como Solicitante podem receber erro; atualize as abas abertas depois da publicação. A migration 056 não preenche `released_at` histórico com `updated_at`, pois isso reproduziria a medição incorreta.

## Validação local

Resultado em 21/09/2026: **478 testes da aplicação em 28 suítes + 12 testes de API/banco aprovados**, checagem de tipos aprovada e build de produção aprovado sem avisos. A sintaxe das funções JavaScript e `git diff --check` também foram verificados. Os chunks de ExcelJS (~944 kB) e JSZip (~97 kB) agora são carregados sob demanda; o maior chunk compartilhado passou de ~2,22 MB para ~1,26 MB.

`npm run test:all` executa a suíte da aplicação e testes Node de API/PostgreSQL (PGlite). São verificados bloqueio de privilégios, importação inválida com rollback, preservação de outros dias, sincronização de ciclos, data de liberação e regressões da interface. `npm run build` verifica TypeScript, templates e empacotamento de produção.

Os testes não enviam e-mail, não chamam SIGMA e não alteram Supabase remoto. Ainda é necessário validar SMTP/URLs e o esquema efetivo no ambiente de implantação. O baseline completo do banco legado não está no repositório, e desenvolvimento continua apontando para os serviços atuais até ser configurado um ambiente separado.
