# Sistema de Expiração Automática de Sessão

## Visão Geral

O sistema implementa logout automático por inatividade para aumentar a segurança da aplicação. Quando um usuário fica inativo por um período determinado, ele é automaticamente deslogado e redirecionado para a página de login.

## Funcionamento

### 1. Detecção de Atividade

O sistema monitora os seguintes eventos para detectar atividade do usuário:
- `mousedown` - Cliques do mouse
- `mousemove` - Movimento do mouse
- `keydown` - Teclas pressionadas
- `scroll` - Rolagem da página
- `touchstart` - Toques em dispositivos móveis
- `click` - Cliques em geral

Qualquer um desses eventos reseta o timer de inatividade.

### 2. Tempos Configurados

Por padrão, o sistema está configurado com:
- **Timeout de inatividade**: 30 minutos
- **Aviso prévio**: 5 minutos antes do logout

Isso significa que:
- Após 25 minutos de inatividade, o usuário recebe um aviso
- Após 30 minutos de inatividade, o logout é executado automaticamente

### 3. Fluxo de Operação

1. **Login**: Quando o usuário faz login, o monitoramento de inatividade é iniciado automaticamente
2. **Atividade**: Cada interação do usuário reseta o timer
3. **Aviso**: Após 25 minutos sem atividade, uma notificação amarela é exibida
4. **Salvamento**: O usuário pode mover o mouse ou pressionar qualquer tecla para continuar conectado
5. **Logout**: Se não houver atividade por 30 minutos, o logout automático é executado
6. **Redirecionamento**: O usuário é levado para a página de login com uma mensagem explicativa

## Arquivos Implementados

### SessionTimeoutService (`src/services/session-timeout.service.ts`)

Responsável por:
- Monitorar eventos de atividade do usuário
- Gerenciar timers de inatividade
- Executar logout automático
- Exibir avisos ao usuário

**Métodos principais:**
- `start()`: Inicia o monitoramento
- `stop()`: Para o monitoramento
- `getTimeSinceLastActivity()`: Retorna tempo desde última atividade
- `isMonitoring()`: Verifica se o monitoramento está ativo

### AppComponent (`src/app/app.component.ts`)

Integração do serviço:
- Inicia o monitoramento quando o usuário faz login
- Para o monitoramento quando o usuário faz logout
- Limpa recursos no `ngOnDestroy`

## Personalização

Para alterar os tempos de inatividade, edite as constantes no arquivo `session-timeout.service.ts`:

```typescript
// Tempo de inatividade em milissegundos (30 minutos)
private readonly INACTIVITY_TIMEOUT = 30 * 60 * 1000;

// Tempo para avisar antes de fazer logout (5 minutos antes)
private readonly WARNING_TIME = 5 * 60 * 1000;
```

### Exemplos de Configuração

**15 minutos de timeout com aviso de 2 minutos:**
```typescript
private readonly INACTIVITY_TIMEOUT = 15 * 60 * 1000;
private readonly WARNING_TIME = 2 * 60 * 1000;
```

**1 hora de timeout com aviso de 10 minutos:**
```typescript
private readonly INACTIVITY_TIMEOUT = 60 * 60 * 1000;
private readonly WARNING_TIME = 10 * 60 * 1000;
```

## Considerações de Performance

O serviço foi otimizado para performance:
- **Execução fora do Angular Zone**: Os listeners de atividade rodam fora do ciclo de detecção de mudanças do Angular para evitar sobrecarga
- **Listeners passivos**: Eventos são registrados de forma eficiente
- **Cleanup adequado**: Todos os timers e listeners são removidos corretamente quando não necessários

## Segurança

Benefícios de segurança:
- Previne acesso não autorizado em estações de trabalho desatendidas
- Reduz o risco de sessões abandonadas serem exploradas
- Garante que tokens de autenticação não fiquem válidos indefinidamente

## Logs de Desenvolvimento

O serviço registra logs no console para facilitar o debug:
- `[SessionTimeout] Starting inactivity monitoring...`
- `[SessionTimeout] Stopping inactivity monitoring...`
- `[SessionTimeout] Inactivity warning shown`
- `[SessionTimeout] Inactivity timeout reached, logging out...`

## Testes Manuais

Para testar o sistema:

1. Faça login no sistema
2. Deixe o navegador aberto sem interagir
3. Após 25 minutos, verifique se o aviso aparece
4. Continue sem interagir
5. Após 30 minutos, verifique se o logout foi executado

**Teste rápido (desenvolvimento):**
Altere temporariamente os valores para testes mais rápidos:
```typescript
private readonly INACTIVITY_TIMEOUT = 2 * 60 * 1000; // 2 minutos
private readonly WARNING_TIME = 30 * 1000; // 30 segundos
```

## Compatibilidade

O sistema funciona em:
- Todos os navegadores modernos (Chrome, Firefox, Safari, Edge)
- Dispositivos desktop e mobile
- Tablets com touch

## Notas Adicionais

- O sistema é independente do sistema de refresh de token do Supabase
- A verificação periódica de sessão a cada 5 minutos (já existente) continua funcionando em paralelo
- O logout por inatividade tem prioridade sobre outras verificações
