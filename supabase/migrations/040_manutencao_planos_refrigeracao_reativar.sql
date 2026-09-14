-- 70 planos de refrigeração/ar-condicionado (área APOIO — SIGMA os tinha como área
-- "REFR", que na migração 032 caiu dentro de APOIO) foram importados já INATIVOS
-- (ativo=false) na migration 032 e nunca fizeram parte do backlog de nenhuma
-- rebalanceamento até aqui. O usuário já tinha enviado, antes desta sessão, uma
-- planilha (SIGMA "Listagem do Browse") com a data real da última manutenção de cada
-- um desses planos — pedido explícito: eles NÃO entram no rebalanceamento geral por
-- dosagem/local (migration 039); a programação deles é sempre derivada dessas datas
-- reais, não de uma data artificial.
--
-- Esta migration:
--   1. Reativa os 70 planos (ativo = true).
--   2. Recalcula data_inicial = data real da última manutenção (da planilha) +
--      periodicidade do plano, avançando ciclo a ciclo até cair na primeira semana
--      aberta (2026-09-21) ou depois — reproduz onde o ciclo real desses planos estaria
--      HOJE se tivessem continuado no ritmo real deles, sem nenhuma redistribuição
--      artificial. É por isso que as datas resultantes já saem naturalmente espalhadas
--      (cada plano tem uma "última manutenção" real diferente).
--   3. Cada data foi ajustada pra segunda-feira da semana em que caiu (o cálculo bruto
--      de "última + periodicidade" pode cair em qualquer dia da semana, inclusive fim de
--      semana — e a sugestão só aparece se a data cair dentro da janela dias-úteis da
--      semana selecionada, ver preventivaVencendo em
--      src/utils/manutencao-preventivas.ts; sem o ajuste, ~1/3 desses planos nunca
--      apareceriam em nenhuma sugestão).
--
-- O casamento planilha -> plano foi feito por (nome da tarefa, TAG/KKS) — usar só o nome
-- da tarefa duplica em casos como "P-R-1M PREV OFF SPLIT SL CONTROLE CCOT", que existe
-- uma vez pra cada um de dois splits diferentes (mesma sala, tags AC90SAG03AH504 e
-- AC90SAG03AH505) com últimas manutenções reais diferentes.

UPDATE manutencao_planos SET data_inicial = '2026-09-21', ativo = true WHERE id = ANY(ARRAY[
    'e92235c5-948c-4250-b24c-1175f28d002b',
    'c40e4c09-cb5f-4995-95b4-e009dbb63ab6',
    '94a5feb7-f80d-4021-9db0-2303a22ecf9f'
  ]::uuid[]); -- 3 planos

UPDATE manutencao_planos SET data_inicial = '2026-09-28', ativo = true WHERE id = ANY(ARRAY[
    '284882b4-e0cb-4c64-8b08-20f627772e72',
    'db968115-0f7b-434f-9b93-ac8419af2c56',
    '3b3172f2-2d6c-4936-aa09-430fce70eb97',
    'a8820bcd-dfe2-4b70-8059-f8441abe2553',
    '6e8a7534-8346-43bb-bc76-447e4e1ba925',
    '478bd306-b011-4284-a969-67f9d759c54c',
    '6ebc7491-83d1-436a-a8e5-e931e559a9a6',
    'cc7f9625-c641-4441-9514-03f12ed32294',
    '75e2fcc6-d4e0-40a0-9ce2-927f235b38c7',
    'c32b9f8f-9608-4f0f-ba1b-6e5030e6cd98',
    '48e837cc-958b-48fe-895e-b8a2397c0f19',
    '50bed31c-7f02-4539-8d1c-467f46022fca',
    '1ae8330f-6192-45da-8df6-fc8e33be30c2',
    '765dca65-ea92-4c5a-878f-90269f0c0ff6'
  ]::uuid[]); -- 14 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-05', ativo = true WHERE id = ANY(ARRAY[
    'a3cd6eb8-ba37-4a77-b002-a522458ebea6',
    '6588b944-d3f1-4236-8367-cad3ca626c18',
    'dcd33ec3-f739-4dd2-9f5a-43a9755ba987',
    '51b06179-6639-4505-ac6f-4e42764dbcb4',
    'a6c43555-7fd3-461d-bfa4-0850ee85465c',
    '74bb7da9-756b-462d-abab-be8780318106',
    'a03e1c8f-93eb-4419-9a35-042378048019',
    '8c9a851c-88c2-4a73-ab3e-1332f07356f3',
    '7720571d-6932-4d12-82d1-f7f61002d286',
    '572e3974-9963-460f-b100-5ff5b6eb65fd',
    '9a9ba63d-6bd6-40b0-ad65-ed637c83d0b4',
    'ee8578ff-f1dc-4476-b0c7-7e7bc71c1a9b'
  ]::uuid[]); -- 12 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-12', ativo = true WHERE id = ANY(ARRAY[
    '24e33d76-ac06-4ab7-921c-8bf98422e10f',
    '95e91786-8029-4301-af01-e95dd8b40e83',
    'fb5fc9b6-8353-47b4-8be5-26c0347c5dbf',
    '25069f71-9a5c-4a2c-8ab2-7fdbbbc260e7',
    '391f6ae3-5f59-47e6-86bf-c04bda851fba',
    '530b86a6-cc0e-40fc-8a39-cb33cc810c3c',
    '9c1ff258-52d8-45f9-9c26-9cd88e8cb87e'
  ]::uuid[]); -- 7 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-19', ativo = true WHERE id = ANY(ARRAY[
    '59c64655-d8d4-42e9-9106-f1c42379b9d3',
    '735840ba-d965-4da7-906e-edb880a8c3f4',
    '87b713f1-9ec7-443a-9f40-fae42f4e9719'
  ]::uuid[]); -- 3 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-09', ativo = true WHERE id = ANY(ARRAY[
    'fde12db8-ad54-40ab-b235-9a07180f810c'
  ]::uuid[]); -- 1 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-16', ativo = true WHERE id = ANY(ARRAY[
    'ae5e59cf-73c5-458d-b892-31fc326daef7',
    '875b9b39-f561-42eb-92cb-5ed2bdcd81c0',
    '036bda27-cab4-4432-8929-ef2ede36e259'
  ]::uuid[]); -- 3 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-07', ativo = true WHERE id = ANY(ARRAY[
    '499668b5-1150-4ca3-a027-58214cee8a38',
    '189c0d5a-71e8-4c3b-b04f-2f3087ce9994',
    '742b3414-1b2c-475d-8904-de45c997cd60'
  ]::uuid[]); -- 3 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-14', ativo = true WHERE id = ANY(ARRAY[
    '229c97aa-ca8a-46d8-b626-67965dde835d',
    'f8df82f1-c79e-49ae-be42-3d0d7e99aa4a',
    'f800a046-f702-4379-a8b4-815bf0afe6d6',
    'de48023b-6237-47e3-b7b9-d3f8d3ee6e00',
    '1af63ec9-bc08-4b18-899f-9d44f7b643f8',
    '673083db-dd54-49d6-9db9-59273a7257b7',
    'f46fdca3-e6dd-4042-8714-362312675b82',
    '72bc3021-1709-419e-9aff-d574a6270723',
    '723ba668-b028-4d47-8236-50564355a96b',
    '6a413cd0-cedf-47d1-9d46-1ea111802e36',
    'fe6e4649-0fee-49f2-b332-15d725cb1abf',
    '8e37493c-b465-4a9e-aedf-f409c2bf7c19',
    '7dd65050-46f4-456a-85c9-0731be79f05f',
    '47893625-51a0-4d61-952b-48fc7264903c',
    '5a8b0d14-eac9-427a-b7e2-b86b72499dfa',
    '1327bbf7-6080-4040-9427-fba08d9e9ad0'
  ]::uuid[]); -- 16 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-21', ativo = true WHERE id = ANY(ARRAY[
    '49e456da-b4b5-4d15-b2c5-f0af0106498a',
    '3cf69d51-6902-46d4-b94f-48ec8a556f03',
    '596885ec-627b-4876-80d5-172f75d4fda3'
  ]::uuid[]); -- 3 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-28', ativo = true WHERE id = ANY(ARRAY[
    'efdb61bd-4e06-4c38-a1e5-6f9b267afbfe'
  ]::uuid[]); -- 1 planos

UPDATE manutencao_planos SET data_inicial = '2027-01-25', ativo = true WHERE id = ANY(ARRAY[
    '531aff44-f033-4767-9778-4a4ab7ae7074'
  ]::uuid[]); -- 1 planos

UPDATE manutencao_planos SET data_inicial = '2027-02-08', ativo = true WHERE id = ANY(ARRAY[
    '31d6e0a5-4483-4920-87ff-c18859131df3',
    'f6a461d0-7b39-48f4-9679-bba0244c2820'
  ]::uuid[]); -- 2 planos

UPDATE manutencao_planos SET data_inicial = '2027-03-01', ativo = true WHERE id = ANY(ARRAY[
    '3f9a3c1a-c34f-4dde-bf04-4e3689cd73f5'
  ]::uuid[]); -- 1 planos

