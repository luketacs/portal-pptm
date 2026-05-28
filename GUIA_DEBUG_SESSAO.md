# 🆘 GUIA DE DEBUG: Loading Infinito / Sessão Expirada

## ⚠️ QUANDO USAR ESTE GUIA

**Sintomas:**
- ✅ Usuário preenche formulário
- ✅ Clica em "Enviar"
- ✅ Nada acontece (loading infinito) OU aparece erro
- ✅ Recarrega página (F5) e funciona

**Este é um problema de SESSÃO EXPIRADA!**

---

## 🔍 COMO DIAGNOSTICAR (Para Desenvolvedores)

### 1. Abrir Console do Navegador (F12)

Procure por estes logs quando o erro ocorrer:

#### ✅ **Logs de Sucesso** (quando funciona):
```
[MaterialForm] 🔄 Renovando sessão antes de enviar...
[AuthService] 🔐 Validando e renovando sessão antes de operação crítica...
[AuthService] ✅ Sessão renovada com sucesso
[AuthService] Token expira em: DD/MM/YYYY HH:MM:SS
[AuthService] ✅ Token validado com sucesso no banco de dados
[MaterialForm] ✅ Sessão renovada, prosseguindo com envio
[MaterialForm] Calling createMaterial service...
[MaterialService] Creating material: {...}
[MaterialForm] Material created successfully
```

#### ❌ **Logs de Erro** (quando falha):
```
[MaterialForm] 🔄 Renovando sessão antes de enviar...
[AuthService] ❌ Falha ao renovar sessão: [ERRO AQUI]
[AuthService] Código do erro: [CÓDIGO]
[MaterialForm] ❌ Sessão inválida: Sua sessão expirou...
```

OU

```
[MaterialForm] Service response received: { error: {...} }
[MaterialForm] ⚠️ Erro de sessão detectado, tentando renovar e reenviar...
[MaterialForm] 🔄 Sessão renovada, reenviando material...
[MaterialForm] Retry response: { data: {...}, error: null }
```

---

## 🛠️ SOLUÇÕES IMEDIATAS (Para Usuários)

### Solução 1: Recarregar ANTES de Preencher (RECOMENDADO)
1. **ANTES** de começar a preencher qualquer formulário
2. Pressione **F5** para recarregar a página
3. Faça login novamente se necessário
4. Preencha o formulário e envie

### Solução 2: Não Demore Mais de 15 Minutos
- Se receber **warning amarelo** na tela: "Você está nesta página há muito tempo"
- Clique em **"Recarregar Agora"**
- Seus dados NÃO serão salvos, então copie para um bloco de notas antes

### Solução 3: Fazer Login de Novo
1. Fazer logout
2. Fazer login novamente
3. Preencher formulário rapidamente (< 5 minutos)
4. Enviar

---

## 🔧 VERIFICAÇÕES TÉCNICAS (Para Desenvolvedores)

### Verificação 1: Token Atual no LocalStorage

Abra console e execute:
```javascript
// Ver dados da sessão
const session = JSON.parse(localStorage.getItem('sb-[PROJECT_ID]-auth-token'));
console.log('Token expira em:', new Date(session.expires_at * 1000));
console.log('Tempo restante:', Math.floor((session.expires_at * 1000 - Date.now()) / 60000), 'minutos');
```

### Verificação 2: Forçar Refresh Manual

Abra console e execute:
```javascript
// Forçar refresh da sessão
const { data, error } = await supabase.auth.refreshSession();
console.log('Refresh result:', data, error);
```

### Verificação 3: Verificar RLS no Supabase

Execute no SQL Editor do Supabase:
```sql
-- Ver políticas RLS da tabela materials
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  qual as using_expression
FROM pg_policies
WHERE tablename = 'materials';

-- Testar se seu usuário consegue inserir
INSERT INTO materials (
  descricao_breve,
  descricao_detalhada,
  unidade,
  ncm,
  estoque_seguranca,
  created_by
VALUES (
  'TESTE',
  'Teste de inserção',
  'UN',
  '12345678',
  false,
  auth.uid()
);
```

---

## 🚀 O QUE FOI CORRIGIDO NO CÓDIGO

### ✅ Mudança 1: Refresh PREVENTIVO (ao invés de reativo)

**Antes (problemático):**
```typescript
// Verificava se estava expirado, SÓ ENTÃO renovava
const session = await getSession();
if (isExpired(session)) {
  await refreshSession();
}
```

**Depois (robusto):**
```typescript
// SEMPRE renova antes de operação crítica
await supabase.auth.refreshSession(); // ✅ Preventivo!
```

**Por quê?** 
- `getSession()` retorna dados do **cache local**
- Cache pode estar desatualizado
- Token pode estar expirado no servidor mas válido no cache
- Solução: **sempre renovar**, sem confiarnull cache

### ✅ Mudança 2: Validação REAL no Banco

**Antes (problemático):**
```typescript
// Usava getUser() que lê do CACHE
const { user } = await supabase.auth.getUser();
return !!user; // ❌ Cache pode mentir!
```

**Depois (robusto):**
```typescript
// Faz query REAL no banco para validar token
const { error } = await supabase
  .from('profiles')
  .select('id')
  .eq('id', userId)
  .single();
  
return !error; // ✅ Se erro, token não funciona!
```

### ✅ Mudança 3: Retry Automático

**Novo comportamento:**
```typescript
// Tenta criar material
let { data, error } = await createMaterial(materialData);

// Se falhar por sessão, renova e tenta MAIS UMA VEZ
if (error?.code === 'PGRST301') { // Erro de autenticação
  await ensureValidSession(); // Renova
  ({ data, error } = await createMaterial(materialData)); // Retry
}
```

### ✅ Mudança 4: Logs Detalhados

Todos os logs agora têm emojis para facilitar identificação:
- 🔐 = Validação de sessão
- 🔄 = Renovação/retry
- ✅ = Sucesso
- ❌ = Erro
- ⚠️ = Warning

---

## 📊 QUANDO CADA PROTEÇÃO ATUA

| Situação | Proteção Ativada | Resultado |
|----------|------------------|-----------|
| Usuário entra no sistema | ✅ Session check normal | Token válido |
| 15min preenchendo form | ⚠️ Warning preventivo | Sugere recarregar |
| Clica "Enviar" | 🔐 `ensureValidSession()` | **Renova token ANTES** |
| Token expirou mesmo após refresh | ❌ Força logout | "Faça login novamente" |
| Supabase retorna erro JWT | 🔄 Retry automático | Renova + tenta novamente |
| Retry também falha | ❌ Erro final | "Recarregue página (F5)" |
| Finally block | ✅ SEMPRE | `isSubmitting = false` |

---

## 🧪 TESTES PARA VALIDAR CORREÇÃO

### Teste 1: Sessão Expirada (Forçado)

1. Fazer login
2. Abrir console (F12)
3. Executar:
   ```javascript
   // Corromper token para forçar expiração
   localStorage.setItem('sb-[PROJECT_ID]-auth-token', JSON.stringify({
     access_token: 'token_invalido',
     expires_at: Math.floor(Date.now() / 1000) - 3600 // 1h no passado
   }));
   ```
4. Preencher formulário e enviar

**Resultado Esperado:**
- `ensureValidSession()` tenta renovar
- Se conseguir: ✅ Submit funciona
- Se não conseguir: ❌ Mostra "Sessão expirada. Recarregue página (F5)"
- Loading NUNCA fica infinito

### Teste 2: Agressão RLS (Simulação)

1. No Supabase SQL Editor, REMOVER política de INSERT temporariamente:
   ```sql
   DROP POLICY "Usuários autenticados podem criar materiais" ON materials;
   ```

2. Tentar criar material no sistema

**Resultado Esperado:**
- Erro: "Você não tem permissão..."
- Loading reseta (finally block)
- Console mostra código de erro RLS

3. Restaurar política:
   ```sql
   CREATE POLICY "Usuários autenticados podem criar materiais"
     ON materials FOR INSERT TO authenticated
     WITH CHECK (true);
   ```

### Teste 3: Preenchimento Prolongado

1. Abrir formulário de material
2. **Aguardar 15 minutos** (ou modificar `SESSION_WARNING_TIME` para 1min em dev)
3. Verificar se warning aparece
4. Clicar em "Recarregar Agora"

**Resultado Esperado:**
- Após tempo definido: ⚠️ Warning amarelo aparece
- Botão recarrega página
- Timer limpo no `ngOnDestroy()`

---

## 📞 O QUE FAZER SE CONTINUAR FALHANDO

### 1. Coletar Logs Completos

Reproduzir erro com console aberto, copiar **TODOS** os logs que aparecem, especialmente:
- Logs do `[AuthService]`
- Logs do `[MaterialForm]`
- Erros em vermelho

### 2. Verificar Configuração Supabase

Execute no SQL Editor:
```sql
-- Verificar políticas RLS
SELECT * FROM pg_policies WHERE tablename = 'materials';

-- Verificar sua sessão
SELECT 
  auth.uid() as meu_id,
  auth.jwt() -> 'exp' as token_expira,
  to_timestamp((auth.jwt() -> 'exp')::bigint) as expiracao_legivel;
```

### 3. Checar Network Tab

1. F12 > Network
2. Filtrar por: `supabase.co`
3. Tentar criar material
4. Ver requisições que falharam
5. Clicar na requisição > Response

Procurar por:
- Status 401 (Unauthorized) = Token inválido
- Status 403 (Forbidden) = RLS bloqueou
- Status 400 (Bad Request) = Dados inválidos

### 4. Aumentar Logs Temporariamente

Adicionar no `material-form.component.ts`:
```typescript
async onSubmit() {
  console.log('='.repeat(50));
  console.log('DEBUG: INICIO DO SUBMIT');
  console.log('DEBUG: Usuário atual:', this.currentUser());
  console.log('DEBUG: Dados do formulário:', this.materialForm.getRawValue());
  console.log('='.repeat(50));
  
  // ... resto do código
}
```

---

## 🎯 CHECKLIST FINAL (Antes de Deploy)

- [ ] Código atualizado com novos métodos
- [ ] AuthService tem `ensureValidSession()` com refresh preventivo
- [ ] AuthService valida token REAL no banco (query profiles)
- [ ] Material-form chama `ensureValidSession()` antes de submit
- [ ] Material-form tem retry automático em caso de erro JWT
- [ ] Request-form também protegido da mesma forma
- [ ] Finally block presente em TODOS os onSubmit()
- [ ] Logs detalhados com emojis implementados
- [ ] Build sem erros (`npm run build`)
- [ ] Testar em ambiente de dev primeiro
- [ ] Monitorar logs em produção primeiras 48h

---

**Data de Criação:** 2026-02-09  
**Última Atualização:** Após correção definitiva com refresh preventivo  
**Status:** 🟢 Implementado e aguardando validação em produção
