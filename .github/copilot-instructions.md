# Orientações do projeto

O Portal PPTM usa Angular 21 standalone, Signals/OnPush, Tailwind, D3, Supabase e funções Node ESM em `api/`. Não usa Gemini nem Angular Material. "Materiais" é um domínio do sistema.

- Componentes ficam em `src/components/`, serviços em `src/services/`, contratos em `src/models/` e regras puras em `src/utils/`.
- Respeite os papéis Admin, Solicitante e Visualizador. Autorização deve existir na API/RLS, além da interface.
- Para listagens completas no Supabase, use os helpers de paginação com ordenação estável. Não publique resultados parciais como completos.
- Importações que substituem dados usam RPC transacional. Ciclos de planos são mantidos pelo trigger da programação.
- Datas civis `YYYY-MM-DD` devem ser tratadas no calendário local (ou UTC integralmente no servidor), sem misturar interpretação UTC com `setHours` local.
- APIs públicas não devem serializar registros individuais de afastamento. O painel usa totais calculados no servidor.
- `npm run test:all` executa regressões da aplicação, API e banco local. `npm run build` verifica templates e produção.
- Preserve mudanças locais existentes e não execute cargas/reset históricos para atualizar um banco já existente.
- Desenvolvimento aponta atualmente para serviços de produção. Não use esse destino para testes de gravação; configure homologação primeiro.
- Mantenha `.env.local` fora do Git. Service role nunca deve entrar no cliente.

Consulte `README.md` e `docs/CORRECOES-2026-09-21.md` para execução e implantação. Guias antigos na raiz podem descrever fluxos anteriores ao código atual.
