-- Teste de disponibilidade do sistema de carvão (EMPILHA / RETOMA): único plano que tem
-- que ser seguido à risca, na data exata da sua cadência. Decisão do usuário:
--
--   1. Fica cadastrado SÓ na OPERAÇÃO (Apoio): PM-0158 (EMPILHA) e PM-0156 (RETOMA).
--      As cópias em Elétrica (PM-0424/PM-0425) e Mecânica (PM-0639/PM-0640) existiam
--      só pra sinalizar às outras áreas que naquela semana tem o teste — são
--      inativadas. As OS já geradas a partir delas continuam existindo; os ciclos delas
--      deixam de pesar na agenda porque plano inativo não entra no cálculo.
--   2. Nova coluna agenda_rigida: plano marcado nunca é antecipado pelo alinhamento por
--      equipamento (alinharDatasPorEquipamento), nem cortado pelo limite semanal da
--      equipe (limitarPorEquipeApoio), e não usa a folga de cobertura de ciclo
--      (proximaDataFixa). Marcada nos dois planos da OPERAÇÃO.
--   3. Os dois testes são mensais e intercalados a cada 15 dias, nunca na mesma semana:
--      RETOMA, +15 dias EMPILHA, +15 dias RETOMA... Os dois foram programados na semana
--      2026-09-21, então a sequência segue daí:
--        RETOMA  (PM-0156): 1 mês, âncora 2026-10-06 -> 06/10, 06/11, 06/12...
--                           (estava 30 dias, que deslizava 1 dia por mês)
--        EMPILHA (PM-0158): 1 mês, âncora 2026-09-21 -> 21/10, 21/11, 21/12... (sem mudança)

BEGIN;

ALTER TABLE manutencao_planos
  ADD COLUMN IF NOT EXISTS agenda_rigida boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN manutencao_planos.agenda_rigida IS
  'Plano segue a data exata da cadência: fora do alinhamento por equipamento e do limite semanal por equipe.';

-- Mesmo motivo da migration 058: portal_validar_reserva_plano barra edição de cadastro
-- sem sessão de Admin (SQL Editor). Desligada só dentro desta transação.
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;

UPDATE manutencao_planos SET agenda_rigida = true WHERE id = ANY(ARRAY[
    '7a8efaa6-701a-43f8-80cb-b91be6c01094', -- PM-0158 P-OP-1M TESTE DISP SIST CARVAO EMPILHA (OPERAÇÃO)
    '4aca5231-0716-427c-8591-307e24225253'  -- PM-0156 P-OP-1M TESTE DISP SIST CARVAO RETOMA  (OPERAÇÃO)
  ]::uuid[]);

UPDATE manutencao_planos
   SET periodicidade_valor = 1, periodicidade_unidade = 'Mes(es)', data_inicial = '2026-10-06'
 WHERE id = '4aca5231-0716-427c-8591-307e24225253'; -- PM-0156 RETOMA

UPDATE manutencao_planos SET ativo = false WHERE id = ANY(ARRAY[
    'a9cd07f4-f6c0-4359-8fd2-b86b2936d4ba', -- PM-0424 EMPILHA (Elétrica)
    'd00c4e20-058b-45cb-ab0b-570497460340', -- PM-0425 RETOMA  (Elétrica)
    '716ce98a-2f66-42f0-b92e-48bb22790de3', -- PM-0640 EMPILHA (Mecânica)
    '370916ff-17cf-4845-8890-0f961a8cafcc'  -- PM-0639 RETOMA  (Mecânica)
  ]::uuid[]);

ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;

COMMIT;
