# Sistema de Status de Materiais

## 📋 Resumo das Alterações

Implementado sistema de status para materiais com dois estados: **Pendente** e **Liberado**.

### ✅ Funcionalidades Implementadas

1. **Status padrão**: Todo novo material criado inicia com status `pendente`
2. **Controle de acesso**: Apenas administradores podem alterar o status
3. **Interface visual**: Badge colorido na listagem para identificar rapidamente o status
4. **Ação rápida**: Botão de alternância para mudar o status com um clique

---

## 🎨 Código Implementado

### 1. Modelo de Dados (`material.model.ts`)
```typescript
export type StatusMaterial = 'pendente' | 'liberado';

export interface Material {
  status?: StatusMaterial; // Status do material (apenas Admin pode alterar)
  // ... outros campos
}
```

### 2. Serviço (`material.service.ts`)
- **Criação**: Define status 'pendente' automaticamente ao criar material
- **Método novo**: `updateMaterialStatus(id, status)` para atualizar apenas o status

### 3. Componente de Lista (`material-list.component.ts`)
- **Método novo**: `toggleMaterialStatus(material)` - Alterna entre pendente/liberado
- **Validação**: Verifica se usuário é admin antes de permitir alteração

### 4. Interface (HTML + CSS)
- **Coluna Status**: Mostra badge verde (Liberado) ou amarelo (Pendente)
- **Botão de Ação**: "Liberar" ou "Marcar Pendente" (visível apenas para admins)

---

## 🗄️ Banco de Dados

Execute o script SQL no Supabase para adicionar a coluna:

```sql
ALTER TABLE materials 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente' 
CHECK (status IN ('pendente', 'liberado'));

UPDATE materials 
SET status = 'pendente' 
WHERE status IS NULL;
```

**Arquivo**: [ADD_STATUS_MATERIALS.sql](ADD_STATUS_MATERIALS.sql)

---

## 🚀 Como Usar

### Para Administradores:

1. **Acessar Lista de Materiais**: Navegue até a seção de materiais
2. **Visualizar Status**: Coluna "Status" mostra o estado atual (badge amarelo = Pendente, verde = Liberado)
3. **Alterar Status**: 
   - Clique no botão "Liberar" para aprovar um material pendente
   - Clique em "Marcar Pendente" para reverter um material liberado
4. **Confirmação**: Sistema pede confirmação antes de alterar

### Para Usuários Comuns:

- Podem visualizar o status dos materiais
- **NÃO** podem alterar o status (botões não aparecem)

---

## 🎯 Casos de Uso

1. **Material novo cadastrado**: Fica como "Pendente" até admin revisar
2. **Admin revisa e aprova**: Clica em "Liberar" → Status vira "Liberado"
3. **Necessidade de revisão**: Admin pode voltar para "Pendente" se necessário

---

## 🎨 Aparência Visual

### Badge de Status:
- 🟡 **Pendente**: Fundo amarelo claro (#fef3c7), texto marrom (#92400e)
- 🟢 **Liberado**: Fundo verde claro (#d1fae5), texto verde escuro (#065f46)

### Botões de Ação (Admin):
- 🔵 **Liberar**: Cor índigo (aparece quando status = pendente)
- 🟣 **Marcar Pendente**: Cor índigo (aparece quando status = liberado)
- 🔵 **Editar Código**: Azul
- 🔴 **Excluir**: Vermelho

---

## 📊 Fluxo de Dados

```
Usuário cria material
    ↓
Status = "pendente" (automático)
    ↓
Admin visualiza na listagem
    ↓
Admin clica "Liberar"
    ↓
Confirmação
    ↓
Status = "liberado"
    ↓
Badge fica verde
```

---

## ⚙️ Configurações Adicionais

### Permissões no Supabase (Row Level Security - RLS)

Se necessário, adicione políticas para garantir que apenas admins alterem o status:

```sql
-- Permitir leitura para todos
CREATE POLICY "Todos podem visualizar materiais"
ON materials FOR SELECT
USING (true);

-- Permitir criação para autenticados (com status pendente)
CREATE POLICY "Usuários autenticados podem criar materiais"
ON materials FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Apenas admins podem atualizar status
CREATE POLICY "Apenas admins podem atualizar status"
ON materials FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'Admin'
  )
);
```

---

## 🔍 Validações

1. **Criação**: Status sempre inicia como 'pendente'
2. **Atualização**: Apenas valores 'pendente' ou 'liberado' são aceitos (validação no banco)
3. **Autorização**: Interface valida role = 'Admin' antes de mostrar botões
4. **Confirmação**: Usuário deve confirmar antes de alterar status

---

## 📝 Notas Importantes

- ✅ Materiais existentes (sem status) serão marcados como 'pendente' após executar o SQL
- ✅ O campo é opcional nas interfaces para compatibilidade com dados antigos
- ✅ A UI trata `status === undefined` como 'pendente'
- ✅ Logs no console ajudam a debugar alterações de status

---

## 🎁 Extras Implementados

- Mensagens de confirmação antes de alterar status
- Alerts de sucesso/erro após operações
- Atualização em tempo real na lista (sem precisar recarregar a página)
- Design responsivo e acessível

---

## 🐛 Troubleshooting

### Botão não aparece para admin:
- Verificar se `currentUser()?.role === 'Admin'` 
- Verificar console do navegador para erros

### Status não salva:
- Verificar se coluna foi criada no Supabase
- Verificar permissões RLS na tabela materials

### Erro ao criar material:
- Garantir que o script SQL foi executado
- Campo status tem valor padrão 'pendente'
