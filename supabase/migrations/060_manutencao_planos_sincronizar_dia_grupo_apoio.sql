-- Sincroniza o DIA dos planos do mesmo equipamento / grupo de salas vizinhas no Apoio.
--
-- Reportado: semana 40 (2026-09-28) ainda trazia os 5 P-R-6M PREVENTIVA OFF COORDENAÇÃO E
-- ENGENHARIA PPTM sozinhos, logo depois dos P-R-1M do mesmo prédio na semana 39 (e do
-- P-R-3M da sala 616 na semana 38) — 3 visitas em 3 semanas seguidas. A migration 058
-- não mexeu neles (vencia na semana em programação), e o código novo de alinhamento só
-- entrou depois dos 1M já programados.
--
-- Causa de fundo, que valia pra todos os grupos: a 058 colocou o plano longo (3M/6M/1A)
-- na mesma SEMANA do plano-base do grupo, mas não no mesmo DIA do mês — com o tempo os
-- dois se afastam (ex. 1M todo dia 19 e 3M dia 14: em março já caem em semanas
-- diferentes).
--
-- Regra: em cada grupo (mesmo KKS, ou grupo de salas vizinhas), o plano-base é o de menor
-- período em meses; todo plano cujo período é múltiplo dele passa a ter data_inicial numa
-- data da sequência do plano-base (mesmo dia do mês), a mais próxima da próxima execução
-- atual, dentro da tolerância de 1/3 do período e nunca antes de 2026-10-05. Assim eles
-- saem sempre juntos, na mesma visita.
--
-- Só Apoio (44 planos). Mecânica/Elétrica ficam pra depois — mexer agora desfaria parte
-- do balanceamento da 058. Planos de agenda rígida (teste de disponibilidade) não entram.
--
-- Prédio 25 (90SAA05AH616..620): P-R-1M dia 21 de todo mês; P-R-6M 28/09 -> 21/10 (junto
-- com o 1M de outubro); P-R-3M -> 21/11.

BEGIN;

ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;

-- Plano que já tem ciclo programado a partir da semana 40 (ex. alguém programou os 6M do
-- Prédio 25 depois da exportação usada aqui) fica como está — mudar a âncora faria a
-- ocorrência reaparecer e duplicar a OS.
CREATE FUNCTION pg_temp.programado_desde_40(p uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM manutencao_ciclos c WHERE c.plano_id = p AND c.data_prevista >= '2026-09-28')
$$;

UPDATE manutencao_planos SET data_inicial = '2026-10-05' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'dc785f55-b1a4-44fa-8258-f72cae12bade'; -- PM-0144 OPERACAO L-OP-2M STACKER 01 (era 2026-10-12)
UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '7d937bf2-5db1-4994-8156-91f6430cea3c'; -- PM-0163 OPERACAO L-OP-2M TCLD (era 2026-11-02)
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '801d6fa5-65e3-4c00-a3de-64e128a220fe'; -- PM-0021 SERVPLEX P-R-6M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-09-28)
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '63b09c44-8f39-4b92-bde9-1ad8f1a84a40'; -- PM-0023 SERVPLEX P-R-6M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-09-28)
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'ac58fdc6-4b44-4ac5-a9f5-25a4721b55a0'; -- PM-0026 SERVPLEX P-R-6M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-09-28)
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '1811adbf-8c9c-4b70-8428-da00f1d99315'; -- PM-0029 SERVPLEX P-R-6M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-09-28)
UPDATE manutencao_planos SET data_inicial = '2026-10-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '7762a9d6-7aec-46cb-a961-64cb01cbfc08'; -- PM-0031 SERVPLEX P-R-6M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-09-28)
UPDATE manutencao_planos SET data_inicial = '2026-10-28' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '3ba9ff6b-b48d-4645-94b4-5bb802feee91'; -- PM-0168 BMS P-SPCI-3M STACKER 01 (era 2026-10-26)
UPDATE manutencao_planos SET data_inicial = '2026-10-28' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '31036727-cbc9-49ff-b74b-36fdb0721db0'; -- PM-0175 BMS P-SPCI-3M STACKER 02 (era 2026-10-26)
UPDATE manutencao_planos SET data_inicial = '2026-10-28' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '68cec49b-8232-483c-ab5c-b48b49763adc'; -- PM-0192 BMS P-SPCI-3M TRANSPORTADOR CORREIA ECA 33 (era 2026-10-26)
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '529ec934-e2b2-449c-9c84-1170a9e386e1'; -- PM-0056 SERVPLEX P-R-3M PREVENTIVA OFF SALA DE LUBRIFICAÇÃO PPTM (era 2026-11-09)
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '49e456da-b4b5-4d15-b2c5-f0af0106498a'; -- PM-0079 SERVPLEX P-R-6M PREV.OFF SPLIT 2 SL ELET STK01 (era 2026-11-09)
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '596885ec-627b-4876-80d5-172f75d4fda3'; -- PM-0085 SERVPLEX P-R-6M PREV.OFF SPLIT 2 SL ELET STK02 (era 2026-11-09)
UPDATE manutencao_planos SET data_inicial = '2026-11-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'fccb9de4-9c05-4ce2-9beb-8138d5a11565'; -- PM-0147 OPERACAO L-OP-2M STACKER 02 (era 2026-11-09)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'e987ce97-c083-4b44-9227-f5decb0b243c'; -- PM-0022 SERVPLEX P-R-3M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-11-16)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '087efe6a-c444-445b-9b7a-ab25081e22fb'; -- PM-0027 SERVPLEX P-R-3M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-11-16)
UPDATE manutencao_planos SET data_inicial = '2026-11-21' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '5c511cfb-56ec-4657-b615-58408802653d'; -- PM-0033 SERVPLEX P-R-3M PREVENTIVA OFF COORDENAÇÃO E ENGENHARIA PPTM (era 2026-11-16)
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '189c0d5a-71e8-4c3b-b04f-2f3087ce9994'; -- PM-0122 SERVPLEX P-R-3M PREV OFF SPLIT SL SUPERV./PLANEJ (era 2026-11-23)
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'a03e1c8f-93eb-4419-9a35-042378048019'; -- PM-0125 SERVPLEX P-R-3M PREV OFF SPLIT SL COFRE (era 2026-11-23)
UPDATE manutencao_planos SET data_inicial = '2026-11-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'ae5e59cf-73c5-458d-b892-31fc326daef7'; -- PM-0126 SERVPLEX P-R-6M PREV OFF SPLIT SL COFRE (era 2026-11-23)
UPDATE manutencao_planos SET data_inicial = '2026-11-28' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '164d1acf-9ba3-41a9-9ce6-9fcafcee966a'; -- PM-0194 BMS P-SPCI-6M CORREIA ECA 33 (era 2026-11-23)
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'f8df82f1-c79e-49ae-be42-3d0d7e99aa4a'; -- PM-0110 SERVPLEX P-R-3M PREV OFF SPLIT SL CONTROLE CCOT (era 2026-11-30)
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '31d6e0a5-4483-4920-87ff-c18859131df3'; -- PM-0114 SERVPLEX P-R-6M PREV OFF SPLIT SL AUTOMAÇÃO (era 2026-11-30)
UPDATE manutencao_planos SET data_inicial = '2026-12-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '7dd65050-46f4-456a-85c9-0731be79f05f'; -- PM-0116 SERVPLEX P-R-3M PREV OFF SPLIT SL PT (era 2026-11-30)
UPDATE manutencao_planos SET data_inicial = '2026-12-05' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '7c7a38d2-6dfb-42c8-b0b4-18de4afadaa1'; -- PM-0195 BMS P-SPCI-6M TRANSPORTADOR CORREIA ECA 41 (era 2026-11-30)
UPDATE manutencao_planos SET data_inicial = '2026-12-09' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'f46fdca3-e6dd-4042-8714-362312675b82'; -- PM-0104 SERVPLEX P-R-6M PREVENTIVA OFF SELF SL 46 (era 2026-12-07)
UPDATE manutencao_planos SET data_inicial = '2026-12-09' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '2a72840e-f1b0-406c-85aa-9da8d9b42ade'; -- PM-0201 BMS P-SPCI-6M TRANSPORTADOR CORREIA ECA 43 (era 2026-12-07)
UPDATE manutencao_planos SET data_inicial = '2026-12-09' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'b713b9fc-6338-4091-badb-59c90afd5c85'; -- PM-0203 BMS P-SPCI-6M TRANSPORTADOR CORREIA ECA 44 (era 2026-12-07)
UPDATE manutencao_planos SET data_inicial = '2026-12-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '531aff44-f033-4767-9778-4a4ab7ae7074'; -- PM-0078 SERVPLEX P-R-6M PREV.OFF SPLIT 1 SL ELET STK01 (era 2026-12-07)
UPDATE manutencao_planos SET data_inicial = '2026-12-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '3cf69d51-6902-46d4-b94f-48ec8a556f03'; -- PM-0082 SERVPLEX P-R-6M PREV.OFF SPLIT 1 SL ELET STK02 (era 2026-12-07)
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'fde12db8-ad54-40ab-b235-9a07180f810c'; -- PM-0132 SERVPLEX P-R-6M PREV OFF SELF 91EAC01AH012 TC05 (era 2026-12-14)
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '5a8b0d14-eac9-427a-b7e2-b86b72499dfa'; -- PM-0133 SERVPLEX P-R-3M PREV OFF SELF 91EAC01AH012 TC05 (era 2026-12-14)
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '8e37493c-b465-4a9e-aedf-f409c2bf7c19'; -- PM-0134 SERVPLEX P-R-3M PREV OFF SELF 91EAC01AH013 TC06 (era 2026-12-14)
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '3f9a3c1a-c34f-4dde-bf04-4e3689cd73f5'; -- PM-0136 SERVPLEX P-R-6M PREV OFF SELF 91EAC01AH013 TC06 (era 2026-12-14)
UPDATE manutencao_planos SET data_inicial = '2026-12-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '036bda27-cab4-4432-8929-ef2ede36e259'; -- PM-0137 SERVPLEX P-R-6M PREV OFF SELF 91EAC01AH014 TC07 (era 2026-12-14)
UPDATE manutencao_planos SET data_inicial = '2027-01-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '875b9b39-f561-42eb-92cb-5ed2bdcd81c0'; -- PM-0108 SERVPLEX P-R-6M PREV OFF SPLIT SL CONTROLE CCOT (era 2026-12-28)
UPDATE manutencao_planos SET data_inicial = '2027-01-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'efdb61bd-4e06-4c38-a1e5-6f9b267afbfe'; -- PM-0111 SERVPLEX P-R-6M PREV OFF SPLIT SL CONTROLE CCOT (era 2026-12-28)
UPDATE manutencao_planos SET data_inicial = '2027-01-02' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = 'f6a461d0-7b39-48f4-9679-bba0244c2820'; -- PM-0115 SERVPLEX P-R-6M PREV OFF SPLIT SL PT (era 2026-12-28)
UPDATE manutencao_planos SET data_inicial = '2027-01-05' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '47893625-51a0-4d61-952b-48fc7264903c'; -- PM-0184 SERVPLEX P-R-6M ARCOND CABINE STR 02 (era 2027-01-04)
UPDATE manutencao_planos SET data_inicial = '2027-01-12' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '6343e950-738f-4bf2-9aef-8fcc24cb1a32'; -- PM-0057 SERVPLEX P-R-6M PREVENTIVA OFF SALA DE LUBRIFICAÇÃO PPTM (era 2027-01-11)
UPDATE manutencao_planos SET data_inicial = '2027-01-19' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '1327bbf7-6080-4040-9427-fba08d9e9ad0'; -- PM-0139 SERVPLEX P-R-3M PREV OFF SELF 91EAC01AH014 TC07 (era 2027-01-18)
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '94a5feb7-f80d-4021-9db0-2303a22ecf9f'; -- PM-0098 SERVPLEX P-R-3M PREV OFF SPLIT SL SUP1 PATIO CARV (era 2027-01-25)
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '6e8a7534-8346-43bb-bc76-447e4e1ba925'; -- PM-0123 SERVPLEX P-R-6M PREV OFF SPLIT SL SUPERV./PLANEJ (era 2027-01-25)
UPDATE manutencao_planos SET data_inicial = '2027-01-26' WHERE ativo AND NOT pg_temp.programado_desde_40(id) AND id = '229c97aa-ca8a-46d8-b626-67965dde835d'; -- PM-0130 SERVPLEX P-R-6M PREV OFF SPLIT SL ELETRICA (era 2027-01-25)

ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;

COMMIT;
