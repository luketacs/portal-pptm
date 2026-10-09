# Fundo Fixo — aprovação pelo Teams

Quando alguém cria uma solicitação de Fundo Fixo (formulário interno ou link público), o
portal manda um card para o chat privado do gestor do setor no Teams. Os botões **Aprovar** e
**Recusar** abrem uma página do portal no navegador, onde o gestor confere e confirma. Depois
disso chega outra mensagem no Teams confirmando a decisão.

Não precisa de licença Premium: o fluxo só usa o gatilho de webhook do Teams e o post do card.

| Setor | Gestor |
|---|---|
| Operação | João Nunes |
| Manutenção | Italo Rosse |
| Infraestrutura | Italo Rosse |
| Outros | ninguém, fica com o Admin no portal (ou com o gestor indicado na solicitação) |

- O Admin continua podendo aprovar ou recusar no portal. **Vale quem decidir primeiro.** Se o
  gestor abrir o link depois, a página mostra que a solicitação já foi decidida.
- O link do card vale só para aquela solicitação, expira em 15 dias e decide uma vez só.
  Abrir o link não decide nada; só o clique em "Confirmar" grava.
- A decisão aparece no portal como `Aprovador: <gestor> (Teams)` e entra no log de auditoria.
  O comentário da recusa vira o motivo.
- Mapeamento no código: `GESTOR_POR_SETOR` em `api/_fundo-fixo-teams-shared.js` e
  `FUNDO_FIXO_GESTOR_POR_SETOR` em `src/services/fundo-fixo.service.ts` (manter os dois iguais).

## 1. Banco

Rodar `supabase/migrations/069_fundo_fixo_aprovacao_teams.sql` no SQL Editor do Supabase.

## 2. Fluxo no Power Automate (2 passos)

**+ Criar → Fluxo da nuvem instantâneo → Ignorar.**

### Gatilho: Microsoft Teams → "When a Teams webhook request is received"
- **Who can trigger the flow:** Anyone. A URL gerada tem uma assinatura (`sig=`); trate como senha.

### Ação: Microsoft Teams → "Post card in a chat or channel"
É a ação **sem** "wait for a response".
- **Post as:** Flow bot
- **Post in:** Chat with Flow bot
- **Recipient:** expressão `triggerBody()?['aprovadorEmail']`
- **Adaptive Card:** expressão `string(triggerBody()?['card'])`

O mesmo fluxo envia tanto o card da solicitação quanto o card de confirmação depois da
decisão. O portal monta os dois; o fluxo só repassa.

**Save.** O **Flow checker** não deve mostrar aviso de licença Premium. Depois abra o
gatilho e copie a URL.

## 3. Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Valor |
|---|---|
| `FUNDO_FIXO_FLOW_URL` | URL do gatilho do fluxo |
| `FUNDO_FIXO_EMAIL_ITALO` | e-mail Microsoft 365 do Italo |
| `FUNDO_FIXO_EMAIL_JOAO` | e-mail Microsoft 365 do João |
| `FUNDO_FIXO_EMAIL_COPIA` | (opcional) quem recebe cópia de todos os cards, separados por vírgula. A cópia vem sem os botões de decisão, só com "Abrir no portal" |
| `FUNDO_FIXO_PORTAL_URL` | (opcional) endereço do portal nos links; padrão `https://portalpptm.vercel.app` |

Sem `FUNDO_FIXO_FLOW_URL`, nada é enviado e tudo funciona como antes (só o Admin aprova).
Depois de configurar, faça um redeploy.

## 4. Testar

1. Coloque temporariamente o **seu** e-mail em `FUNDO_FIXO_EMAIL_JOAO` e faça um redeploy.
2. Crie uma solicitação no setor Operação. O card deve chegar no seu chat com o Flow bot, e o
   portal deve mostrar "Aguardando João Nunes no Teams".
3. Clique em **Recusar**: a página abre com "Recusar" já marcado. Escreva um motivo e
   confirme. O status deve mudar para Recusado, e deve chegar no Teams o card
   "Recusa registrada".
4. Abra o mesmo link de novo: a página deve mostrar "Solicitação já recusada".
5. Volte o e-mail real do João e faça um redeploy.

Se o envio falhar (fluxo desligado, erro 500), `teams_enviado_em` volta para NULL e o erro
aparece nos logs da Vercel com o prefixo `[fundo-fixo-teams]`.
