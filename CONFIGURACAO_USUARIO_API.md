# Configuração das Variáveis de Ambiente para Criação de Usuários

## Problema Resolvido
O erro 403 ao criar usuários ocorria porque o código tentava usar `auth.admin.createUser()` diretamente do frontend, que requer a chave `service_role_key`. Expor essa chave no frontend é um **risco de segurança**.

## Solução Implementada
Foi criada uma função serverless (`/api/create-user.js`) que roda no backend (Vercel), mantendo a `service_role_key` segura.

## Configuração Necessária

### 1. Obter as Credenciais do Supabase

1. Acesse seu projeto no [Supabase](https://supabase.com)
2. Vá em **Project Settings** > **API**
3. Copie os seguintes valores:
   - **URL**: `https://your-project.supabase.co`
   - **service_role key** (atenção: NÃO é a `anon` key!)

### 2. Configurar no Vercel (Produção)

1. Acesse seu projeto no [Vercel Dashboard](https://vercel.com/dashboard)
2. Vá em **Settings** > **Environment Variables**
3. Adicione as seguintes variáveis:

   | Nome | Valor |
   |------|-------|
   | `SUPABASE_URL` | `https://your-project.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Sua service_role key do Supabase |

4. Clique em **Save**
5. Faça um novo deploy (ou espere o próximo push)

### 3. Configurar Localmente (Desenvolvimento)

1. Crie um arquivo `.env.local` na raiz do projeto (se ainda não existir)
2. Adicione as variáveis:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

3. **IMPORTANTE**: Nunca faça commit do arquivo `.env.local` no Git!

### 4. Testar

1. Após configurar as variáveis de ambiente
2. Faça deploy ou rode localmente
3. Tente criar um novo usuário
4. O erro 403 não deve mais aparecer

## Segurança

⚠️ **NUNCA** exponha a `service_role_key` no código frontend ou em repositórios Git!

- A `anon` key pode ficar no código frontend (`supabase.config.ts`)
- A `service_role_key` deve ficar **apenas** nas variáveis de ambiente do servidor

## Troubleshooting

### Erro 500 "Configuração do servidor incompleta"
- Verifique se as variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estão configuradas corretamente no Vercel ou `.env.local`

### Erro 403 ainda aparece
- Verifique se você está usando a **service_role key** e não a anon key
- Verifique se as variáveis de ambiente foram salvas corretamente no Vercel
- Faça um novo deploy após configurar as variáveis

### Como verificar se a API está funcionando

No console do navegador, você pode testar:

```javascript
fetch('/api/create-user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'test@example.com',
    password: 'TestPassword123!',
    name: 'Test User',
    role: 'Solicitante'
  })
}).then(r => r.json()).then(console.log)
```

Se receber `{success: true}`, a API está funcionando!
