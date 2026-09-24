-- Rebalanceamento das preventivas (set/2026), gerado a partir da simulação de carga
-- semanal em cima dos planos ativos e ciclos exportados em 2026-09-24. Considera os DOIS
-- cenários: planta parada (ativa hoje — ciclo < 30 dias de Elétrica/Mecânica vira mensal,
-- ver periodicidadeEfetiva) e operação normal, com peso maior pra parada.
--
-- Regras combinadas com o usuário:
--   1. Plano semanal sai TODA semana. 58 semanais tinham data_inicial em 2027 e não
--      apareciam até lá.
--      - Apoio (não afetado pela parada): âncora volta pra semana 2026-09-21.
--      - Elétrica/Mecânica com ciclo < 30 dias: âncora num dos 28 dias de 2026-08-25 a
--        2026-09-21. Em operação normal a cadência é a mesma (começa já); na parada (mensal a
--        partir da âncora) isso espalha esses planos pelas 4 semanas do mês, em vez de
--        todos caírem juntos no mesmo dia.
--   2. Demais planos: nova data_inicial numa segunda-feira, escolhida pra nivelar a
--      quantidade de preventivas por semana (por área; no Apoio, por equipe), com
--      prioridade pra mesma semana de outros planos do mesmo KKS/grupo vizinho.
--      Janela: data prevista hoje +- 1/3 do período (tolerância de atraso). Quando a
--      data prevista estava a mais de 1 período no futuro (133 planos — ex. mensal que
--      só começava em jan/2027), a janela é o 1º período a partir de 2026-10-05.
--   3. Não mexe em: plano com ciclo já programado a partir de 2026-10-05, plano que já vence
--      nas semanas 2026-09-21 / 2026-09-28 (programação em andamento), plano inativo.
--
-- Preventivas por semana nas próximas 26 semanas, mín-máx (antes -> depois):
--  Planta parada:
--   MECANICA   13-68  ->   37-58  (média 50.4)
--   ELETRICA   11-31  ->   20-26  (média 22.8)
--   SERVPLEX    4-14  ->    4-11  (média 8.5)
--   OPERACAO    2-8   ->    5-9   (média 6.9)
--   BMS         0-6   ->    0-6   (média 2.7)
--  Operação normal:
--   MECANICA   27-116 ->  104-115 (média 108.4)
--   ELETRICA   12-36  ->   27-33  (média 30.5)
--   SERVPLEX    4-14  ->    4-11  (média 8.5)
--   OPERACAO    2-8   ->    5-9   (média 6.9)
--   BMS         0-6   ->    0-6   (média 2.7)

BEGIN;

-- portal_validar_reserva_plano (migration 054) só libera edição de cadastro pra sessão
-- de Admin/service_role — no SQL Editor não há usuário logado (auth.uid() nulo) e ela
-- barra tudo. Desliga só durante esta transação; religada no fim, antes do COMMIT.
ALTER TABLE manutencao_planos DISABLE TRIGGER portal_validar_reserva_plano;

UPDATE manutencao_planos SET data_inicial = '2026-08-25' WHERE ativo AND id = ANY(ARRAY[
    '0b67cb04-f09f-461e-ada5-43774e112fd4',
    '2aba90fe-7e43-43a5-bfff-018570558be9',
    '41626e64-be74-41bc-aa0d-c57653f17a22',
    '45e5ef6a-f6b1-493a-8615-5cb9e7033fe7',
    '4cc1ca3a-a595-455e-85a5-5e7c0958099a',
    '4ffa65a3-f906-42c0-a888-d62194f8e800',
    '9d7484e3-cafa-43dd-909a-d98fa0f8b747',
    'a4336804-44e7-408c-a460-dde0ad043a66',
    'cb888ea1-d96e-4523-8014-e9d3a97650af'
  ]::uuid[]); -- 9 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-08-26' WHERE ativo AND id = ANY(ARRAY[
    '1f5f120f-6d3a-4859-b328-16ba49639954',
    'dd90d218-dbb2-4a1e-87cd-6731c404a5f9'
  ]::uuid[]); -- 2 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-08-27' WHERE ativo AND id = ANY(ARRAY[
    '004e02de-23dc-4b79-896e-f7ffa014c37d',
    '03779f6d-67d5-4e89-b0c6-e1a2250d86ec',
    '2861828b-11ab-4856-8caa-ac5840a13cfc',
    '5e048e91-a22d-4dad-8084-9b6d8b0c2e5c',
    '6d4816ca-67db-433d-a415-997cd6747859',
    '6d749f16-29d4-477f-a1b1-44c9b37b43b9',
    '72177ad7-ba8e-444d-8815-af0f0160f247',
    '81cb0200-e518-412b-83fe-33060f5812eb',
    '9b96f401-9c99-4495-8f70-7f9d5bf2a2a7',
    '9e4a89f8-bd2a-49b4-8b20-f770f1de596b',
    'a930063a-0c5d-4cad-a002-44ba5b9b7cbb',
    'dcf531da-a1a6-4d81-970b-ea7d9d638723',
    'e2a13e79-c1b6-4aed-a115-f3213a5a6910',
    'eb240d0b-081f-4d0b-ae1e-411a37d46a83',
    'fbcc4ce5-bdaa-4284-bb0e-c36799ed0291'
  ]::uuid[]); -- 15 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-08-28' WHERE ativo AND id = ANY(ARRAY[
    '238e6d10-b6ec-4729-a765-5ddf9de09af4',
    'bc91eab4-2e13-4c8a-9b8f-254af2130d26',
    'cee6d4c4-b4ef-4dec-a482-172b5ac0cc48',
    'e2d66aa2-d582-41cf-8321-334767c3dd2c',
    'e9ac66cb-9b72-4367-b33d-e8a9a3aa9504'
  ]::uuid[]); -- 5 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-04' WHERE ativo AND id = ANY(ARRAY[
    '01eeacfb-4928-41e9-95d7-7b90d8728be3',
    '02f5b673-5f5c-4acf-8ec9-fd5b15d1b5ec',
    '0dd81c0b-9a1e-40d2-92c1-baba3d0402ae',
    '124d9ad2-e1fa-46c7-a241-2bde7e814a98',
    '1e0026e1-88ed-4e6b-b16b-76710fa420bf',
    '1e17a914-68ad-4af1-ae9d-c01ecbe28a92',
    '27cf9738-bce1-43b7-a3fb-8b360a5cc3d6',
    '2a914da5-1dc7-4606-abed-f0a97071dcad',
    '3dc2d159-b685-4ebd-9636-a67d17f16dac',
    '3e0e16bc-7868-4a96-9386-db27a602e59e',
    '426a6cb7-3052-460d-b92d-8e4a622229b6',
    '440991df-b40b-4fa0-bdf1-47e99e42c004',
    '4ec84a81-1b6c-4ca1-b61e-277c276f0faa',
    '5447e59d-d2e8-4700-b672-5494d6ee8c48',
    '56f205fc-4a49-4814-baf9-7cef197f04aa',
    '573422c5-4c78-45ea-b96b-242aec895916',
    '61763179-8911-4a35-92de-3b58eb42f7cc',
    '6868b718-9c39-4c1e-a346-f17dc21c5632',
    '7febb00b-8a39-47eb-8d3d-d2b040e6fa16',
    '80ed9851-a40a-48b4-8930-d72e3a2dd119',
    '822357b1-f4db-4843-b568-1995db870359',
    '8f96bcf2-b2d8-4a21-ac0d-488eb1acdd85',
    '9164ba95-47c5-4046-84ae-a7722450dcf5',
    '9432f975-7121-424b-b4fc-30b6e42953dc',
    '9714812b-2680-4ba7-aef9-dab36eeab28b',
    '9c224ecf-d4e5-40cf-953e-03dc93a82993',
    'ae1d5b74-09f1-4632-bb39-91f3e6637943',
    'ae8de049-01a1-4523-806a-69ab868ce1de',
    'b7f868a1-12de-4209-90d5-c6891a2ab830',
    'b9bad777-5298-439c-931d-df772bfa067e',
    'be4e4592-48f5-467b-ac87-9c34eaeface6',
    'c05aec0d-2357-4fba-9d7a-0a25a79b24c2',
    'cc4179c5-e5b2-41b7-ad38-29342bf0a07a',
    'd013dead-c48e-4fe7-8c6c-7223b7c8e010',
    'd243a9cc-3920-41c7-9c02-1569d58ab610',
    'daba104b-2daf-4a94-95a4-f801127ec7f8',
    'e37c3818-62ac-47aa-80ea-18391b09c9a1',
    'ef15e6d2-b292-4cd7-b797-5316ef9e2c7b',
    'f080b0fd-0aae-4a3f-851e-b10e0d494669',
    'f6a5cdf3-66c4-4897-bde0-1c2a89cc402c',
    'fc7160d8-83c2-44f5-acbf-063a0077d192',
    'fcfc8203-8f15-44a0-8290-667c0c25c34f'
  ]::uuid[]); -- 42 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-11' WHERE ativo AND id = ANY(ARRAY[
    '07c045b8-add9-4336-8ba9-68778344f31c',
    '0ea803c4-c18c-445a-aeaf-718763017522',
    '1c8c33c4-ffdf-4ce7-a51a-dbc9013ab6bf',
    '1f41a8ff-978b-4205-97cf-b2de89882169',
    '2309d213-0043-4500-8f8c-8670f79a0f47',
    '3100c43b-6f49-49c4-a8e6-21a15aaaa146',
    '371052b1-89eb-444e-b777-62ff072f92d0',
    '4d40357a-02c1-40f3-9c62-8ff7ed987d80',
    '717ce4d5-4a44-4d2d-85df-16244984633b',
    '788d8059-f3a7-4200-baef-920dd78eff1f',
    '9b57431c-30a8-406b-b40d-32c283b87955',
    'a254d67c-335f-4e0a-9a2d-fc46c629648a',
    'a529328f-88dc-4548-b1a1-ad8a3027dd01',
    'a5b721f9-4e66-4292-97e8-c8c40caaf6bf',
    'b574a8d3-437c-4ea6-ab05-e0f2e88c6a9d',
    'bba3f9fd-e2e4-4593-b243-9e100def8169',
    'bd3243b8-5d11-4669-a047-d39b390321ea',
    'e33a7281-d643-46b8-84de-f54f79e18701',
    'e632f53b-d019-48c1-9956-80e2ec35e03d',
    'f3f3146f-0756-47fe-bef3-974528e87f4c',
    'f85b7b2e-3d26-4068-9445-3ca7a45ec254',
    'fe4264a5-5521-4ede-ba34-f48becf5d448'
  ]::uuid[]); -- 22 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-12' WHERE ativo AND id = ANY(ARRAY[
    '4f8f4aaf-4002-467a-b4c0-0da80d63cb9a',
    'c774a5fc-ca70-43c9-93f2-c006d00e2a77'
  ]::uuid[]); -- 2 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-13' WHERE ativo AND id = ANY(ARRAY[
    '358b9c59-7816-47a2-9be3-e8a171ded14c',
    '5278b274-2783-434d-9af0-4ad188dec9b9',
    '6a113f5d-b0db-4831-95d7-d99d40938344',
    '793dbfae-634b-4599-bbe3-20eec8c13574',
    'c0f5213b-efb2-42e6-9e88-74f5e15b89b5',
    'f5061827-0f7b-46a8-913e-83457ee970a3',
    'f8c0f5cc-b949-4f19-8272-4049b35bcacc'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-14' WHERE ativo AND id = ANY(ARRAY[
    '01ba59ac-7273-49a1-b588-41cfa0a6786b'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-16' WHERE ativo AND id = ANY(ARRAY[
    '0c57a601-955e-4b2f-80bb-d05fe4a693e6'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-18' WHERE ativo AND id = ANY(ARRAY[
    '4260e5ed-4a67-4435-a97b-498e38912287',
    '80f8d111-7243-43ff-9832-d710751c8a5a',
    '82aa1835-1bde-487d-bb71-4b889d1eb8c6',
    '8733f20c-90df-479b-8884-7e418ec007c8',
    '93dd9ba0-ea3b-41b9-989c-75b31ead42cc',
    '99049b82-6be7-43bf-886d-b8662a671729',
    'ab6abd54-c8df-4fbf-afe7-d0febb76f1f9',
    'c0a4205a-b1e0-4ebb-bc1c-7e6fc62556da',
    'd0538950-2111-483b-becb-2612f204ad44',
    'd7f33fc1-df78-4c17-8f84-396a4c151cb5',
    'dfd86ee7-fab3-4299-80cf-143fdc3836f7',
    'e3a2c611-c24d-4ba7-a945-979105af5ed0',
    'f43ffb98-43a3-4923-a7d6-fe2860363bc3'
  ]::uuid[]); -- 13 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-19' WHERE ativo AND id = ANY(ARRAY[
    '22333e73-2fc2-460a-8c22-03747b7c669b',
    '35ec3b1a-3ec9-4610-95b3-3e7af948e778',
    '6842b14e-a8ba-434b-b0ba-f40fd9be46e3',
    '7806a9c4-572b-41c5-bffa-3125664b88e4',
    '82658249-dfad-4201-83fd-9739460725f4',
    'cbec47f1-e1b9-4846-ae43-60836e9559ef'
  ]::uuid[]); -- 6 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-20' WHERE ativo AND id = ANY(ARRAY[
    '3eea4d59-c255-4e6c-9bd3-cead06a70ec6',
    '5894884c-730f-4cd3-9434-101411226ce7',
    '989a5701-b68e-46f9-86c1-6ad6c87e408e',
    'ab748c50-d1e9-4b60-a980-15bb3174054a',
    'b6a946d8-6959-4d93-9456-973aa64e87b7',
    'bec4d774-fbf8-4631-96ed-1af813f9fb32',
    'e5d0321a-44fa-4b9c-8056-e1c0bf76fbb2'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-09-21' WHERE ativo AND id = ANY(ARRAY[
    '0827086d-5402-41c3-bddb-dc8e322f5fd8',
    '0e9fe777-d553-4a7f-8f97-f2e3c4a9b06d',
    '1b51890d-0cf8-4af5-b942-e9901046103b',
    '5332f9a6-f47e-4c4f-a797-7171b9f79ace',
    '55e63f0e-54fa-4cb1-a761-3793f041068a',
    '73988f66-5993-4bee-a088-c005045772e1',
    'ca3bdbd5-1972-4dce-bc6c-c40edce2df16',
    'ffbeb7f5-003e-40c5-8407-89258352dde2'
  ]::uuid[]); -- 8 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-10-05' WHERE ativo AND id = ANY(ARRAY[
    '106c5595-ad54-4d86-ba23-f5208feadd92',
    '15994576-21a0-46d8-b84b-701539491f8f',
    '1af63ec9-bc08-4b18-899f-9d44f7b643f8',
    '24b6a9c6-7638-40a8-ab5c-c1cd8d05ce5e',
    '2a8f0f8f-9004-4e60-81ea-74a543a1340b',
    '2b4bbf68-552a-40ef-83e3-a2005b885c7b',
    '2bb59eb6-ced9-40fd-b0b1-62551e0d56f3',
    '31c4c6e0-1864-4f39-9229-9f15b982f8ef',
    '3cb0e595-0281-4407-9706-56c0a492c8c9',
    '4531fff5-1258-4367-884c-1bb43da7a6b2',
    '480c380e-0e75-4421-88bd-46f1c45380a5',
    '48e837cc-958b-48fe-895e-b8a2397c0f19',
    '499668b5-1150-4ca3-a027-58214cee8a38',
    '4c938852-3184-4a84-a84b-6b506d04bce2',
    '530b86a6-cc0e-40fc-8a39-cb33cc810c3c',
    '54385ac9-7c44-42cc-a743-629b7f1dd225',
    '55308641-993d-4d61-8d53-a2d120b2e84f',
    '5ab49524-3e6c-43c5-935f-60dc560a41e3',
    '5ba1f1eb-804c-4e76-b2d4-46d1b28a2c2a',
    '638a88bb-7525-4724-b76d-30a473d8bac0',
    '63ce8c37-6af2-423f-850c-e1d7004fad45',
    '7276c81d-4ea5-4b11-947a-46f4c6cbdbee',
    '742b3414-1b2c-475d-8904-de45c997cd60',
    '83aaac8c-57bb-4634-b0cb-9103188b4ada',
    '8622daae-f081-4bfb-9bfd-11b7f1d33b54',
    '864b8042-2e83-499e-95e6-2b8b32a85bcc',
    '8c9a851c-88c2-4a73-ab3e-1332f07356f3',
    '8ea03333-5876-4f91-a92a-19187ff8eacb',
    '9c1ff258-52d8-45f9-9c26-9cd88e8cb87e',
    '9e30b85e-3974-4be2-b4a0-f15826f673ce',
    '9e55b471-0e63-4f3c-9a8a-ce7fa6cf9547',
    'a5fa83be-00f1-4ce1-98d5-671f66e89763',
    'a682f467-e450-4a5c-9a1b-1d8eee256dfa',
    'a6c43555-7fd3-461d-bfa4-0850ee85465c',
    'a84bb1ef-b65d-4fb0-8d85-4bab72269fb4',
    'ad6b0855-347d-4cbc-b784-c77a672abf3b',
    'b4eb9624-9a84-42a6-aed7-5740d923d0a6',
    'bc0b0a7c-5eee-499d-a0f3-055014afea63',
    'c11d6e37-031f-4ec2-a50d-88ad34cc5751',
    'c4a4e941-4c8a-4d9a-9b36-0e0c8306b2bf',
    'c7e971ae-f852-458d-b101-cfb869d94436',
    'd80692b3-0d58-4c56-883c-fa69c2ce7bbc',
    'dcc4795b-8ed6-4afb-98d2-5088a0934cc2',
    'ec4c7c9b-930d-4d6e-9f8f-745eb889c286',
    'f0e6d0fa-4165-45b3-af57-af633e70aad0',
    'f184c35d-416b-41e3-a72d-bb894bd5c5ff',
    'fbe89192-f003-408a-b0f1-478cf267db17',
    'fcc90664-5ee8-4941-8113-1c3a840d67e8'
  ]::uuid[]); -- 48 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-10-12' WHERE ativo AND id = ANY(ARRAY[
    '00740a5e-17aa-4906-bbf8-e6a3e964e665',
    '10502f3f-a97b-4b38-98dc-4ac9a54a1e73',
    '10b0f7a7-1964-42ef-baab-6f2e3b340c4d',
    '223e3266-23ac-47ac-89b2-21bc8174638b',
    '284882b4-e0cb-4c64-8b08-20f627772e72',
    '2b7ab252-547c-4782-8f79-d5ee71f9d376',
    '2fef5ab9-ca5b-4318-a7d4-c6bbc6a547ea',
    '30edf8c3-7a55-4417-812d-e414b19ab5dc',
    '33cc9ca9-1ad3-4c0b-a2a6-c658cb2962e4',
    '370916ff-17cf-4845-8890-0f961a8cafcc',
    '38c14873-181c-4c82-9d3b-9750825e04f3',
    '39252adc-8d69-435e-a17e-8ed7d907fe61',
    '3c0f0ab8-77db-4fd2-8f22-e7b1eec38c66',
    '438be176-4062-4d67-9790-51e24b31b7db',
    '487afa7f-a7c7-42d0-bc23-e97d87d8f70f',
    '5820fe42-3591-4fe6-87e2-4ae36fb798f2',
    '5a103320-2c34-4fe2-a3b2-5f05011f04b5',
    '66908d03-0567-4cfc-9f84-35a412e3c240',
    '66d924a7-49fd-42ee-879a-4698c3457c8f',
    '6825c224-1fed-477b-8796-168bb3d37bb8',
    '716ce98a-2f66-42f0-b92e-48bb22790de3',
    '8564caa5-f7de-4170-84d0-b5931fd0b64f',
    '88dde779-0139-4ca7-a23c-6be7bc5a629d',
    '8f57dee4-9db6-4001-aa46-22dca0665c73',
    '93190c29-4af4-4328-8782-5113665b32ba',
    '95e91786-8029-4301-af01-e95dd8b40e83',
    '996c1d69-00ad-4928-8424-e02aafcb0780',
    '9a9ba63d-6bd6-40b0-ad65-ed637c83d0b4',
    '9cd83b61-8e13-430e-9c87-5fc7dd242952',
    '9fdc22cd-21e3-46a3-a395-44e5c1079aa9',
    'aa526c88-e166-44bf-888e-3ef3f3dc059d',
    'ac8e437b-acd4-44e4-85c5-a004af839d0b',
    'b3f438c7-bacc-4a7a-a670-57a9337f31f9',
    'bbdf332a-0e65-4725-9db0-71609c8c853c',
    'da9794e4-3d4a-4092-86d7-35ebf3945817',
    'dadc0d51-2dce-4ec5-b00c-cb2518bb2a0d',
    'db968115-0f7b-434f-9b93-ac8419af2c56',
    'dc785f55-b1a4-44fa-8258-f72cae12bade',
    'dd55c0d9-4446-4cd1-9d8f-775ec9d2b870',
    'e1e2c062-316b-42e1-9b62-f87af928502f',
    'e682a891-369b-41dc-8f91-e1aa5f7a9733',
    'ebf51b97-38dd-466e-927a-5b6e6a73f3f8',
    'ee456616-8901-4496-8ce4-a48ed930288a',
    'f35e374a-8444-4e58-a60b-f50936462919',
    'f43b4f49-985e-47b0-b9e6-b02ef22489e2',
    'f6ef8132-0ce8-466d-a4e7-9c99e769de6f',
    'fcd1459a-039f-4c99-bdfb-11b36afed374'
  ]::uuid[]); -- 47 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE ativo AND id = ANY(ARRAY[
    '052a51ba-7584-4de3-b9f3-a84f21c7acad',
    '1ae8330f-6192-45da-8df6-fc8e33be30c2',
    '1f91ed81-61ac-4c0c-b79e-d5a86cfcb341',
    '33db92d2-28e7-45ef-a6f0-2e2615314690',
    '3ad5406a-d28e-44f2-8cf3-775395134f2e',
    '45a066d3-919b-48f4-a83b-d0d289b86737',
    '477e186f-0695-4a05-aab7-17ac885c7ae4',
    '5d67df22-7cc7-4d2c-a379-5de05d11df89',
    '647aed2c-7ab2-49fc-a878-824229a952ce',
    '64b9458b-5ca6-4a53-a83b-eae16d92ece3',
    '6a082fdc-c23b-41f1-8ce3-f7421e4a8203',
    '6d06f714-3503-484c-b718-842030417b0c',
    '6ebc7491-83d1-436a-a8e5-e931e559a9a6',
    '7443131b-33f6-4070-82f0-4f6df468aad2',
    '76e08aad-f488-4064-b0a3-6dcc3a369153',
    '99f76552-42a1-4248-abff-6077bbc9bd99',
    '9bdd12ff-2c63-43ee-8fb0-2cef76f1a423',
    '9d49fbe5-a3fb-476d-938a-06a828414f98',
    '9e184544-98c5-43ef-98a4-818bca453279',
    'a1e4ed81-2ce8-49a6-8722-dea557eb9115',
    'a3d61d1d-c5c5-482b-98bb-79a13fd76ea9',
    'a98d3b96-6633-40ec-8107-47132c7b3998',
    'af6aa8c2-4ef1-431b-bc62-9f077cdc937c',
    'af969629-2791-4195-9aaa-e7917eb9c8a7',
    'afd74d07-abf1-46e9-b424-c741b62cf0b8',
    'bc29d3f7-852e-4379-b76d-b5d97b358eca',
    'bc863596-baf9-496b-b0a5-32d8c6286dc2',
    'bf494d94-0be0-4cc5-94f1-ba8f9d2771d2',
    'c9d19d8f-987b-48d5-8d2f-250392a66fb2',
    'cc7f9625-c641-4441-9514-03f12ed32294',
    'dc5499bc-bb26-45f8-9ebb-a486e4475e32',
    'de8b9c9f-1904-43fc-aff8-ad0b291c4c08',
    'e442616b-c323-42b5-b71f-5daca8d21827',
    'f1582a75-8e51-4973-92b1-59368d61685c',
    'fdfcbc7e-0141-4283-a478-ec9db6ebf515'
  ]::uuid[]); -- 35 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE ativo AND id = ANY(ARRAY[
    '0b4c8e3e-fb57-450e-a1ef-3328f940b708',
    '0c2e6349-6370-4dc3-b4a7-a17cd94eab66',
    '0c699b21-43c9-4fc6-bfcc-169ef401e16e',
    '11cf1cb6-d41e-4b63-bde5-82cd841d74df',
    '13aa5611-30b2-4851-b97a-3ba62bd1d12e',
    '19a43e27-9c03-4a9f-bb70-5ee82a8d2388',
    '1ec45da2-9ba9-40bd-815d-c1a5e201a052',
    '25069f71-9a5c-4a2c-8ab2-7fdbbbc260e7',
    '29cf9b96-9417-4d39-b8c8-aeac4f761777',
    '2ee124c4-489e-46d1-abc2-dbaefb121e2a',
    '31036727-cbc9-49ff-b74b-36fdb0721db0',
    '3ba9ff6b-b48d-4645-94b4-5bb802feee91',
    '3dc92ed2-7f38-49cd-b7ff-66114c90af51',
    '478bd306-b011-4284-a969-67f9d759c54c',
    '490fb4d6-6654-411c-8bda-94ceaf1b524e',
    '5c382a05-a69d-48dc-9507-fe4a70930f40',
    '5c80e4ff-c84f-4208-9291-85e2f032b628',
    '5e98689a-3707-40ec-9077-a056aa22d992',
    '5f3a43b6-092b-4dde-a9e0-e748dbc4b8cf',
    '68cec49b-8232-483c-ab5c-b48b49763adc',
    '715537a2-11b3-4c82-b23f-dc41a6735be2',
    '72bc3021-1709-419e-9aff-d574a6270723',
    '73621ed0-7a28-4add-8045-06a08d6aa16e',
    '791f1d02-916a-4151-8178-68f0b30eb3b1',
    '80faec84-463b-4dbd-85a4-ded426933934',
    '87b713f1-9ec7-443a-9f40-fae42f4e9719',
    '88007328-868f-41b2-96be-b4fcdc8094fb',
    '88413928-dc08-494c-b0b2-f9e045df8e97',
    '8d098efe-902a-4044-949d-372a1a8e16bf',
    '8fee4118-82d6-4f37-9edf-bcc5cc0499c7',
    '984eaa8b-fd7a-49b5-aa5e-2faaf5b34b00',
    '9889d84d-882d-415e-828c-428dbf8819ee',
    '9951dc24-2330-433f-bd40-bc1c4fef10cf',
    '9e03eaa1-7ed2-4634-8da6-ac964a2c5e46',
    '9f9b195b-841f-4a57-b61c-b5ca180180f7',
    'a02ac409-9d22-496c-a396-93548a4b2886',
    'a8820bcd-dfe2-4b70-8059-f8441abe2553',
    'bdb1ad29-8625-42d8-96a8-d4b58676b44c',
    'c365dd19-ec47-4161-a154-df77249b27f5',
    'c40e4c09-cb5f-4995-95b4-e009dbb63ab6',
    'c7bd0971-d08d-4c59-be69-23e758d4f31b',
    'cb22c11e-23e4-4682-a94c-6e81bc4c89cb',
    'd14c7b0c-0348-4db2-ab8d-881e27af61e8',
    'e13431b7-e079-4df5-99e1-80ec75925dab',
    'f0575686-a5d5-451b-9a61-aa8be9946e7d',
    'f12e72b8-7510-47c4-bdfe-e8a4ccd49499',
    'ff73cfe9-a57c-4016-98eb-07a50994268a',
    'ffa55632-0e97-4665-aee9-b3a45a8a997c'
  ]::uuid[]); -- 48 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE ativo AND id = ANY(ARRAY[
    '0eb5bb29-1590-45df-a95d-e22165c85ccc',
    '105a2d89-a659-4f2a-97b2-06fd8ec4b9eb',
    '1bb41576-001f-4370-b43a-90a06a2b6990',
    '3b3172f2-2d6c-4936-aa09-430fce70eb97',
    '4a16a5a4-85e6-4f08-b5ee-fa1a762e385a',
    '504a8e9f-f692-4839-adcb-ccb6bedab471',
    '50b91aa0-162a-43e7-8cb9-79746f691c8e',
    '50bed31c-7f02-4539-8d1c-467f46022fca',
    '5bf8d31f-eb64-40dd-9d83-6867fc3e1256',
    '5c9dd30b-a115-4fa1-b14c-ac663adee3a3',
    '6b349159-d754-4666-b873-bf1e20d983e0',
    '765dca65-ea92-4c5a-878f-90269f0c0ff6',
    '7857254a-01f0-491c-833d-17df868c5388',
    '7d937bf2-5db1-4994-8156-91f6430cea3c',
    '844918d4-abc5-4346-8f51-f51b146c3a66',
    '847cedc8-c608-414e-abdb-8166d5129024',
    '91d4ab7e-77a8-45c8-9e9e-e5c43b53c489',
    '9aa41ae7-e6b1-4700-8e97-51f0e05c3a6b',
    '9cbcfebd-79bf-4ebc-94ee-34fd2edc7498',
    '9eefa090-5649-43f5-a678-05ad0ce244d7',
    'a90ed4a0-215c-4267-8a83-cd3e2fa849fc',
    'b4f5d912-feb3-4646-970a-c72f9befe2c9',
    'b60e002b-7a60-48af-9486-b4dd567ebd98',
    'c32b9f8f-9608-4f0f-ba1b-6e5030e6cd98',
    'cd7f8f58-1054-4553-9038-c062b199e430',
    'd9d4302c-cbfc-49a8-8df1-2558fe315ec9',
    'e58af49e-62b0-487b-bee7-c274416d681e'
  ]::uuid[]); -- 27 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-11-09' WHERE ativo AND id = ANY(ARRAY[
    '019fabd8-c594-401a-b029-70778100f79a',
    '26760b53-415b-4d5b-b461-4d5c97eab64a',
    '277dc85a-d95f-40a7-ba9e-e07b3775c43c',
    '2f28a698-4ca8-44eb-83ac-ecd76ae6271b',
    '31a97529-ff1c-45d2-b6c3-e5a6b7370a49',
    '3a6d2fa4-b576-4529-9932-b1e6ee0188f2',
    '3d0dd9f4-d661-43e4-92f9-2624ecfd28ff',
    '3fa44b71-bc06-4f0f-9f81-d79e21a7ffa0',
    '41c25f68-cadd-426b-b811-dac0b64152c0',
    '43962c3a-c9ae-4fa3-8ebc-63a1ffd18c5d',
    '49e456da-b4b5-4d15-b2c5-f0af0106498a',
    '529ec934-e2b2-449c-9c84-1170a9e386e1',
    '596885ec-627b-4876-80d5-172f75d4fda3',
    '5e256f39-35af-47bf-a248-d876103b290e',
    '61089983-283d-43a3-aaaf-936fe49551ba',
    '652d4e1d-722d-4497-82f0-885d76d754a3',
    '75f63ebf-a367-40d3-9d13-5cca0ef3f592',
    '8cb4ab1b-9f95-459e-83a5-ba9b913357f3',
    '9ac60bd0-e5b3-4638-8f44-bbbef58d5de2',
    'b92edf96-f5ee-4c42-97f4-f94b60a2fec1',
    'b9965de7-e95d-4d06-823b-e0dc7200da27',
    'bdfce42b-040c-4627-af3f-4fad9e008cca',
    'd90a3a68-6947-4cb3-b13e-55e766a2cbf5',
    'e18182a9-db57-455d-aac7-565b83581b90',
    'eacd5a8c-9661-4c27-a5f1-fe4ad34b59c2',
    'ee8578ff-f1dc-4476-b0c7-7e7bc71c1a9b',
    'f65ccc10-184a-41bb-beff-03ddbfce0468',
    'fccb9de4-9c05-4ce2-9beb-8138d5a11565'
  ]::uuid[]); -- 28 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-11-16' WHERE ativo AND id = ANY(ARRAY[
    '022a1fe6-2061-4225-b921-615878567119',
    '087efe6a-c444-445b-9b7a-ab25081e22fb',
    '1018448d-d6ff-4da3-b198-787e16318955',
    '24c8a1e1-e6d1-4659-a526-a7b84e770aa1',
    '425c5923-c0ea-4f69-9161-896dc78e25fb',
    '4ac8b201-76d4-4ff7-8d27-a385c80b94e1',
    '52f7703f-b413-415c-a308-eba8f35e2ecd',
    '5c511cfb-56ec-4657-b615-58408802653d',
    '68941378-c0ab-4cfb-88be-7a481697a5cc',
    '758d808f-6dd7-48fa-85fc-f7481c41ea83',
    '770bb301-8d63-4139-adfe-7b8819e716e6',
    '7bbd2c28-44a2-4c0b-8187-e57b3f0e86f7',
    'bc777647-dd58-4e69-aba4-b81f2b0f0d37',
    'c8cce003-19e4-46ba-99ff-82da0df5ddac',
    'd3077d25-18cc-40a3-8f56-3f94a7bbde3e',
    'dbfde6fb-ee24-4a96-af43-e6d29bfcb9b7',
    'e1c98ed6-b1aa-466d-96d9-fcd807417abd',
    'e987ce97-c083-4b44-9227-f5decb0b243c',
    'fab0bc9b-1b35-4604-a430-fdc0507cc8ed'
  ]::uuid[]); -- 19 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-11-23' WHERE ativo AND id = ANY(ARRAY[
    '12c9fa4a-cbd0-4da6-a606-d638734ba94c',
    '164d1acf-9ba3-41a9-9ce6-9fcafcee966a',
    '2b2955bd-ceea-4ca1-96da-0a68faab211d',
    '337cb72e-678c-4983-9aa0-5dd9a40040b7',
    '49bd540f-d60a-4066-81ba-bc74611ab677',
    '71ae585d-2080-49af-a865-1a10ed79a64b',
    '813ad8b1-fc8b-4607-973d-3bb55d4ca899',
    '898c72cf-a150-4c1f-ae31-377737d2380b',
    '8ac7e6ef-02bc-43ba-8635-a4c14ae8368c',
    '8b219171-cfee-42b7-953f-4a313353d194',
    '8b729230-7b1a-434b-bf15-6157177baa42',
    'ae5e59cf-73c5-458d-b892-31fc326daef7',
    'aef6e04c-a60f-4328-a834-4aa8e167f8b6',
    'c5514e63-4cfd-4c0c-8b10-b4e5076540ba',
    'c880dc1d-455c-4b00-8d2c-0fc371edd736',
    'd6d63f4a-03b3-45b7-b02c-39016468736d',
    'e4c5b508-7835-42a3-9b9a-7b9ee481d599'
  ]::uuid[]); -- 17 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-11-30' WHERE ativo AND id = ANY(ARRAY[
    '021bf74d-901a-4109-a706-b516013fba31',
    '0f2ca09e-5565-42b9-ae0a-e56b1a92ca48',
    '31d6e0a5-4483-4920-87ff-c18859131df3',
    '3e19fcaa-6741-48d2-ae20-2bc3026083d3',
    '4329cafb-2dec-4ebd-99db-310f166dbcf8',
    '4f9dc94b-4bf2-491b-8e8b-1e51a95caae8',
    '60bdf6ae-97f6-498e-a7da-fc7803eb96ec',
    '62095238-8478-41cf-aaf2-d3fc60e6aff6',
    '680445f4-cee6-4c23-b5ef-d197b6de7fca',
    '7c7a38d2-6dfb-42c8-b0b4-18de4afadaa1',
    '7dd65050-46f4-456a-85c9-0731be79f05f',
    '84584a49-07ae-4a7e-b81f-53536be21570',
    'b3725d5f-921f-4ee8-8d42-043f457eaffb',
    'c1b7a3d4-4dee-4f9d-9280-148ca799b934',
    'f27ed8a4-c7ae-4396-92df-3af20da14fe9',
    'f8df82f1-c79e-49ae-be42-3d0d7e99aa4a',
    'fed563a4-5fe4-4525-8361-e9e560cabaee'
  ]::uuid[]); -- 17 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-12-07' WHERE ativo AND id = ANY(ARRAY[
    '017ad33e-1711-48f3-8a7c-83565c56c658',
    '03293bcf-701b-40c6-b5b0-0feb0d3e73eb',
    '2a72840e-f1b0-406c-85aa-9da8d9b42ade',
    '2c095283-6d84-4ca8-8a36-4e2208d54730',
    '3cf69d51-6902-46d4-b94f-48ec8a556f03',
    '3de043f9-2162-46c8-b0ea-ec6ae24e4b5b',
    '47636777-7268-4c6c-aba5-38482aa433fd',
    '4eb35a71-8bb6-4ebb-9956-709359646546',
    '4f1b4523-cf47-4148-98ef-f8244fbf4e56',
    '507b4e96-e4af-4292-882d-7817f6b1ecda',
    '531aff44-f033-4767-9778-4a4ab7ae7074',
    '61f0f153-ae57-4756-a646-6317c6553d06',
    '6ab1a852-fd39-4567-8d7d-9238bb7eec91',
    '994cec5f-9661-49e5-8099-0a0e5cc3dd9d',
    'a38786e8-8b82-4860-a4aa-f88a532d0eb8',
    'b713b9fc-6338-4091-badb-59c90afd5c85',
    'c74ae42f-f69d-40dd-9054-bca703d534f7',
    'edb521c3-06f2-48f3-95dc-cd66071b349f',
    'f46fdca3-e6dd-4042-8714-362312675b82'
  ]::uuid[]); -- 19 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-12-14' WHERE ativo AND id = ANY(ARRAY[
    '036bda27-cab4-4432-8929-ef2ede36e259',
    '047ce9c2-dd99-4fcb-aeb1-ce8c541f3362',
    '0d921415-00d0-43d4-82b2-0d08a5194507',
    '1cbd7ea9-3c3e-4763-bfc7-fa16317ed3ac',
    '322a1aa7-3fa3-4b3f-bb8d-930ea9c7736d',
    '355ba3db-14a9-4fe8-bfe2-021655f65891',
    '372715b1-f2e9-4ad9-a052-d88bc31c93f3',
    '3f9a3c1a-c34f-4dde-bf04-4e3689cd73f5',
    '534d0718-4f32-4b71-ac5d-010a93bb35d2',
    '547cbc89-ce5b-4618-9e36-55de121ac973',
    '5a8b0d14-eac9-427a-b7e2-b86b72499dfa',
    '656d9451-3989-4e67-97d6-e05e47fd5b5a',
    '6bdfcc8e-f5bb-4eca-a548-dae06cd93c92',
    '7ee61352-587e-4320-9752-f6c725f5e328',
    '8e37493c-b465-4a9e-aedf-f409c2bf7c19',
    '919a73d6-10a3-47ca-b4fa-d723771881ca',
    '99d89db5-7040-47aa-b508-f029f8c46502',
    '9eda692e-ec48-4357-9481-71b51bc61204',
    'ac67073b-62b3-4691-bd63-4faa01fe6916',
    'c241f822-81b1-47c4-912b-2af90104f149',
    'cd40e3ca-ca92-4e6d-8a6a-b2daac7659b5',
    'df40692d-2df1-4851-a69b-5da990a18c36',
    'e1bfe6bc-ecd4-40bc-8a21-e0d3c374f308',
    'fc2e7fe8-ab9c-4c67-ae3f-413d5a06d342',
    'fde12db8-ad54-40ab-b235-9a07180f810c'
  ]::uuid[]); -- 25 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-12-21' WHERE ativo AND id = ANY(ARRAY[
    '07e51d38-0fe5-480c-ba12-09020589cd2d',
    '0cd3f306-c246-4318-8109-04ea971b21bc',
    '0e6a7dfa-51f6-4ebe-829b-05690496d004',
    '4b8c05b4-a76b-4ebb-8279-e218fe6811e2',
    '54af7067-9ecb-401f-9982-39b992566caf',
    '68e3e533-c8e0-4955-a2b1-99a43c3ff6a4',
    '85488cf6-431b-4dac-9815-1e9b84ad48a1',
    '9ba160ab-d970-412c-afec-d34c1613d798',
    '9c578e34-ff35-4aee-b955-80dc77e552a3',
    'b548a2be-0a2d-40b1-a14c-0ce700dd6b2a',
    'edf5a361-4659-4f00-b3b5-237df7817074'
  ]::uuid[]); -- 11 plano(s)

UPDATE manutencao_planos SET data_inicial = '2026-12-28' WHERE ativo AND id = ANY(ARRAY[
    '06a16a4f-f77f-4442-bc1d-06fe8bf84d93',
    '0bd98746-7c4c-4151-baa0-c48d305234c0',
    '0d5bec22-f8c7-4a21-afb3-849300a83c3a',
    '0d683d3c-9284-466b-aebc-892ed613a6a5',
    '13c10c02-a9f1-44a9-b4c8-df7edd3f7f57',
    '1a0c26db-02e1-4410-aaff-77ffb5282614',
    '1ea348c4-b002-4e1c-b8b0-69cf5c0d6e3c',
    '211a886a-beef-477c-b2f8-d06818adfaec',
    '38c77bb8-748a-4282-950a-5df1c5dd5bc4',
    '3f3233a3-26a0-4a51-a841-a9c0438258df',
    '3f7d0bb9-db0b-4f63-ac7d-8625bbe3637b',
    '3fed1e32-78d1-443b-8619-93b791c11861',
    '4634a815-dc0d-4085-bbda-d6c94ca3ddba',
    '5c4ebddf-c740-48fa-b8a7-cc92f3571ae2',
    '5fbcea9f-0615-4ecc-b55f-bdf317c7f2d6',
    '6355328c-e38e-4162-bb5a-aee1581ce3c1',
    '7297ae65-d2a0-486b-9f84-81fd75af3d49',
    '78feb959-899d-4e22-9b8a-bc8cadabe62b',
    '8693fc62-75dd-4dd6-ab13-12b5cf17ea54',
    '875b9b39-f561-42eb-92cb-5ed2bdcd81c0',
    '8c63a00f-b33e-4121-85e7-187d7a96bcfe',
    'a2490eaf-f54a-4943-bc67-784c7b0be4c3',
    'b1b9ccc2-386a-40f4-b1d3-d37ea0f845b6',
    'dc8066ab-0129-45b2-86ac-b8ba180c22f1',
    'ebc7926e-57b5-4cbe-8763-2ea1c875b0f6',
    'efdb61bd-4e06-4c38-a1e5-6f9b267afbfe',
    'f6a461d0-7b39-48f4-9679-bba0244c2820',
    'f7c37a00-496d-4e4a-9711-3d39fe304975'
  ]::uuid[]); -- 28 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-01-04' WHERE ativo AND id = ANY(ARRAY[
    '00f854c9-37ee-4cf7-8eac-ceff6a349f88',
    '1f8db8a9-9781-43cd-bf50-62b0577cffdc',
    '2005a504-f79c-4ef0-9f55-9e570aeb100d',
    '47893625-51a0-4d61-952b-48fc7264903c',
    '47d69217-f42b-46a9-9c8b-6f97e7f45056',
    '57920efd-574d-42f3-b42f-be6ad69c2006',
    '62389f6b-0946-4eeb-9b90-61ea9bf0bb70',
    '96c1cbc9-359d-44a8-8464-5c5ea47b8753',
    'a7d888b2-4f67-4754-ab61-507bad3052e5',
    'bf5565fd-aafd-466d-959c-4ae894d65563',
    'c08b8b08-1892-4fc1-b6c0-1792fd003285',
    'cb8cd886-8f7f-4eeb-8d37-ec1e81c020f9',
    'dbd9f371-6cf5-4b2e-98e5-9d1640009ebe'
  ]::uuid[]); -- 13 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-01-11' WHERE ativo AND id = ANY(ARRAY[
    '03eebc55-9b1c-4143-ac18-f7187c5eef9a',
    '061b4349-0954-4e2b-8802-9759601ee1a9',
    '0fecbcc1-de35-4b46-a0ed-2dd07a20ce37',
    '1012ae8d-d9a9-43f5-8411-2a791e0d0985',
    '24dca0db-9cba-48f5-9b1d-7170d4fed5fc',
    '30712abc-de9b-47a4-9aa8-5eac91d131b5',
    '4e9a6688-8000-455b-aefc-fffb2d83ccd5',
    '5bd5dfe9-ec8f-4717-88e5-e926aa375434',
    '6343e950-738f-4bf2-9aef-8fcc24cb1a32',
    'a85aa7ca-a626-4e10-af51-4ee1394a77cc',
    'c177abf2-314c-4f92-a580-949b32df6a27',
    'ede22a20-eaf2-4d35-82f3-5ba046f97b90',
    'f8d1398c-1fa0-4d20-89f7-bd98b95dfd73'
  ]::uuid[]); -- 13 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-01-18' WHERE ativo AND id = ANY(ARRAY[
    '1327bbf7-6080-4040-9427-fba08d9e9ad0',
    '6f855798-61c6-4f90-b418-8b82c1ed157a',
    '99ef8bad-437b-4e1c-8133-474c4ca23663',
    'b1cd5603-6e57-4fcf-bd19-bb0a682c9f01',
    'bb812e7a-b598-4c18-b204-817401cf1665',
    'bd154319-9f17-4510-ac2d-2cd3e7da3924',
    'eb32d183-cebd-44ee-8671-c34adf9bb6f7',
    'f00127c4-7f90-4060-9698-0feaf467f74a',
    'fa4020ab-929d-4a6c-8487-9eb267a01b0b',
    'fb2bd5f9-1804-4038-8f5a-4337642c88cf'
  ]::uuid[]); -- 10 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-01-25' WHERE ativo AND id = ANY(ARRAY[
    '229c97aa-ca8a-46d8-b626-67965dde835d',
    '34490619-87c8-41bf-b664-7017a4ba1b3e',
    '5456fe3c-7093-4782-a9a2-5baa926c2d7d',
    '608f7edb-9d29-4d12-a5e9-d5162c44d2a5',
    '6e8a7534-8346-43bb-bc76-447e4e1ba925',
    '707a63e1-7428-42d0-ae77-55f8522edff2',
    '94a5feb7-f80d-4021-9db0-2303a22ecf9f',
    'c62d7493-2439-4c27-9294-509c97a043ae',
    'f3a6eed4-2655-48c4-a7b6-02d8a1dee6c0'
  ]::uuid[]); -- 9 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-02-01' WHERE ativo AND id = ANY(ARRAY[
    '06b6c456-ab08-438c-a53b-2e9732853cc0',
    '0caf49ee-bf80-4ae7-aac7-3a570b754739',
    '2027b632-c780-4620-93c2-9ab892dd54d1',
    '615b4698-1bb1-4d0a-90e6-7cace660456f',
    '69a68920-a645-419d-bfe1-d47318b00763',
    '753a48dc-540a-4a33-a428-3087ff58ad48',
    'b60eba30-8a4a-4323-b845-4ab20f2ee8c0',
    'cd612355-906f-4f55-ba1d-2e82d4895294',
    'f7937eed-4564-46bd-959e-31a34cd17b4f'
  ]::uuid[]); -- 9 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-02-08' WHERE ativo AND id = ANY(ARRAY[
    '2dd09010-8453-4420-a203-b023e830ea3e',
    '317b072c-2476-498e-81de-db54ba5f065b',
    '4a7b7c85-8cb2-42cd-b3f7-848d1f0abae3',
    '836f4e26-056b-4071-a734-f8440fc3fbfe',
    'a92e49af-e569-41f9-b7ce-1b0f0f27da8d',
    'a94feb7e-3b80-4bf2-9b3f-35d4194b9ee3',
    'c1176880-b4c3-4648-bd4c-4961eea10ef7'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-02-15' WHERE ativo AND id = ANY(ARRAY[
    '06ae56d5-6bf3-4936-b828-6a59bc031c9d',
    '71b49b7b-aed2-43ec-9cda-b5e06b458643',
    '79e6e96c-2d5f-42ca-89d4-74212fe47446',
    '93c20bd3-59f4-4ad6-9236-ab26e4b1cd3e',
    'c6effb2b-23dc-4b2d-9d7b-ea23d2f34189',
    'df6680a7-305f-496b-92d7-a9d80ddaebe7',
    'ff7d4084-f0f9-4dbb-a3cc-6cd9b317a7e8'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-02-22' WHERE ativo AND id = ANY(ARRAY[
    '73b37bea-c930-43ec-9f9b-03fa213e6e80',
    '74ad41b5-1994-4b76-8403-83da1cf342aa',
    '8d998555-36c6-4a8e-944e-1cb867d50910',
    'c8d63009-afa4-4623-b327-eefbde9ffdb3'
  ]::uuid[]); -- 4 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-03-01' WHERE ativo AND id = ANY(ARRAY[
    '026b0b2e-b2f3-480f-81c9-1ddd9d3e5aeb',
    '702600c6-abaa-4862-aae9-e28ad84f75c3',
    '9bebf338-fd30-4491-b6da-f0325ac2f81d',
    'affe54b5-3480-4c33-8fe0-43ace5898528',
    'bcd7fbf5-186a-44e3-9fd6-7270c137d7d6',
    'e47a1362-da61-4c26-8f94-889406bb0f2f'
  ]::uuid[]); -- 6 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-03-08' WHERE ativo AND id = ANY(ARRAY[
    '0ae41cd2-b4aa-44ab-8e9c-ec5805f6dc9d',
    '453905bb-297e-4f10-9151-91692addb8b3',
    '501aa35f-29be-4b94-ad9e-bb8a7c9c33df',
    'c5eb98b1-f759-46e5-a4ae-e613df379821',
    'd898d4eb-e745-4038-88a3-da7e32e87609'
  ]::uuid[]); -- 5 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-03-15' WHERE ativo AND id = ANY(ARRAY[
    '19c1cfad-38ae-4b9c-976e-f1f9c7e89a6b',
    '291273c9-421b-41e8-978e-f1c7931af0cd',
    '51025498-5993-46a9-b70f-ca8f5eea889e',
    '6b57ee5f-ef78-4764-a88f-8fedf8dbf9a6',
    '9c3e5f8c-0428-4381-a97f-6a9367bae4ad',
    'ee8bbfdb-2c2e-43db-856a-fddc477748fb'
  ]::uuid[]); -- 6 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-03-22' WHERE ativo AND id = ANY(ARRAY[
    '2d9baf49-81c2-49a2-b52d-d5e36e0bc50e',
    'a29d7cb0-9f89-414d-b7bd-01be48041f1f',
    'd533d453-c8f5-4228-ad68-3cf8611ce4ef'
  ]::uuid[]); -- 3 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-03-29' WHERE ativo AND id = ANY(ARRAY[
    '38592aa1-ba14-40e0-b70d-a2425ce7fa16',
    '47f43a26-1d5d-4b45-8f30-e2a15041a9ef',
    '4cc9d55a-4ef3-4650-a905-8bf714fdcac0',
    '6dcca4b4-06bd-461e-8c24-5ac46b5ca405',
    '84852983-47ed-4e7d-9bb4-70cd20676b50',
    'a86504e6-6457-4c66-b2ea-2aa3e4df863a',
    'b9c5660e-abc5-4ac3-9891-b72a496e212c',
    'e22a3aeb-0267-40b9-a804-aa47f344cc0f'
  ]::uuid[]); -- 8 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-04-05' WHERE ativo AND id = ANY(ARRAY[
    '34e823a9-6999-46c4-930d-e104786d136f',
    '4d26895c-28c5-4901-8f32-e45c4e330de0',
    '5b0e02cf-2df2-4062-8255-6eb2638ec39e',
    '7ddb37d2-d0c5-41eb-b2da-f14cb9bedc72',
    '8185edc5-ae36-4799-a192-45b917d1c744',
    'f40939f9-1bed-4de1-8065-d701df5eee39'
  ]::uuid[]); -- 6 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-04-12' WHERE ativo AND id = ANY(ARRAY[
    '5231a0b7-9733-4bf6-9898-08c62c8186d0',
    '8649b391-9849-4e38-a917-f8f65acda078',
    '9d3d6818-ee7f-4dad-b32d-c2da8e728afc',
    'af31f16d-1b7b-484d-8fda-4453d6bf54fc',
    'd71435de-2de7-4681-bd14-0f6a35777ca4',
    'de4d26ec-d059-4634-a8ba-f745ed30be86',
    'e4a8fb72-adce-4c8f-ab75-fe2a2ec9a9d7',
    'f164f66c-8f4e-499c-a8fc-2abc77fba879'
  ]::uuid[]); -- 8 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-04-19' WHERE ativo AND id = ANY(ARRAY[
    '41016bc4-694a-46d1-9d7b-1e86ae8a04e9',
    '5d49e572-bb7a-4c4d-b8a6-ad9213388f40',
    '68501312-644b-499f-b75f-9084f540b548',
    '6b722bab-ea9b-4602-b4e7-b243bf04ee41',
    'd425de3b-f2c8-44ca-b3a6-53acb5929cd9',
    'f5bc86dc-92a7-46f8-95fe-d318cfda24a6'
  ]::uuid[]); -- 6 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-04-26' WHERE ativo AND id = ANY(ARRAY[
    '5d49f8cd-8fd6-407d-bdb0-8a9b968eb4c0',
    'edcd65a7-44d8-4302-b1cc-d3a11389ca08',
    'f9ae5da9-5996-47d2-8c5b-fd61bf861fb9'
  ]::uuid[]); -- 3 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-05-03' WHERE ativo AND id = ANY(ARRAY[
    '14f9d891-d4af-4f8d-af0a-0591568813b5',
    '2ef54c3d-e5e3-46f4-98cf-70521b224753',
    '47464667-a9b8-4b3f-ab64-ddefe9bbd00c',
    '4cdf1fc1-a090-474c-9705-4c2fc249a5d4',
    '79ee4e18-4aa5-4b33-8b4e-60ceb7cf1eb4',
    '89ceb8dd-b422-4bda-8c1e-21d3f8772413',
    'f2729655-43d2-491b-82b3-e5352dc077a5'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-05-10' WHERE ativo AND id = ANY(ARRAY[
    '84e26447-5b06-42e2-8c5d-970374a21688',
    '9847511e-fef4-4e21-87d3-32581d0848db',
    '9d7d9d63-bd5f-4d52-a4b4-4d948072a329',
    'a0319b9f-0a9c-4bb5-9358-218048d88783',
    'a2cfb053-d63c-4949-9856-9cc3f2e36498',
    'd7d67b49-117e-489e-a287-bb196dc62002',
    'fceca198-10a2-44c2-a36e-441895df7ced'
  ]::uuid[]); -- 7 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-05-17' WHERE ativo AND id = ANY(ARRAY[
    '33d510ff-c044-48a1-a337-ed88148ba6e9',
    '99fcd17e-9478-4e3f-b583-eb0320c55863',
    'eaa5781b-dbf5-423c-ae16-fd9f23e2f753'
  ]::uuid[]); -- 3 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-05-24' WHERE ativo AND id = ANY(ARRAY[
    'b890c327-ec00-4f79-a4b3-8816a5a13bae',
    'c8ffa39b-7d7e-44af-90ed-f29e67e45a41',
    'd239f41e-3510-4e66-b423-b382e2590846',
    'f372d137-23e3-4ac8-ade2-d3b21bc461f3'
  ]::uuid[]); -- 4 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-05-31' WHERE ativo AND id = ANY(ARRAY[
    '062ba1e1-9646-4cca-9e02-b8084c211a97',
    '0ed36719-964f-4e10-bdd3-bf9885972fa1'
  ]::uuid[]); -- 2 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-07-05' WHERE ativo AND id = ANY(ARRAY[
    '649a3f27-24df-4295-b6fd-7afc6ed8f159'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-07-19' WHERE ativo AND id = ANY(ARRAY[
    'fe53aa80-d110-46ac-923c-b9c44a71627c'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-08-16' WHERE ativo AND id = ANY(ARRAY[
    '84cfbc96-7a02-4765-8906-82cb3716b1fd'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-09-06' WHERE ativo AND id = ANY(ARRAY[
    '14c8ee75-1303-42ce-9f99-1d0abaad776b'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-09-27' WHERE ativo AND id = ANY(ARRAY[
    '97f657bd-13c3-49ce-8129-847e2aca7fc8'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2027-10-04' WHERE ativo AND id = ANY(ARRAY[
    '5a94058d-d5a2-4521-b971-645482597ee6'
  ]::uuid[]); -- 1 plano(s)

UPDATE manutencao_planos SET data_inicial = '2028-01-17' WHERE ativo AND id = ANY(ARRAY[
    '1f5a7439-0ca3-4c6c-8b4f-98d4d7195536'
  ]::uuid[]); -- 1 plano(s)

-- Ciclo gravado muito à frente da semana da própria OS: sobra da âncora em 2027 (a
-- sugestão mostrava a data futura e ela virava a chave do ciclo). Com isso o plano
-- ficava escondido até essa data (ex. L-OP-1S PÁTIO DE CARVÃO, ciclo 2027-02-04).
-- Traz o ciclo pra semana real da OS. UNIQUE (plano_id, data_prevista): quando o mesmo
-- plano tem VÁRIAS OS na mesma semana (ex. P-OP-1M TESTE DISP SIST CARVAO EMPILHA, 4
-- ciclos 2026-11..2027-02 com OS na semana 2026-09-21), só o ciclo mais cedo de cada
-- (plano, semana) é movido — os demais ficam como estão, pra revisão manual. Também pula
-- se o plano já tiver ciclo nessa semana.
WITH alvo AS (
  SELECT DISTINCT ON (c.plano_id, o.semana_inicio) c.id, o.semana_inicio
    FROM manutencao_ciclos c
    JOIN manutencao_programacao o ON o.id = c.ordem_id
   WHERE c.data_prevista > o.semana_inicio + 21
     AND NOT EXISTS (
       SELECT 1 FROM manutencao_ciclos c2
        WHERE c2.plano_id = c.plano_id AND c2.data_prevista = o.semana_inicio
     )
   ORDER BY c.plano_id, o.semana_inicio, c.data_prevista
)
UPDATE manutencao_ciclos c
   SET data_prevista = alvo.semana_inicio
  FROM alvo
 WHERE c.id = alvo.id;

ALTER TABLE manutencao_planos ENABLE TRIGGER portal_validar_reserva_plano;

COMMIT;
