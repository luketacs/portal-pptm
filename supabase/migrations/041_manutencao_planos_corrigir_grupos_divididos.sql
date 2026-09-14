-- A migration 039 deveria garantir que planos do MESMO equipamento (mesmo TAG/KKS —
-- ex. as 3 variantes de periodicidade de "BANCO BATERIAS TC06") sempre saíssem na
-- mesma semana. Uma verificação nos dados reais (não na simulação) encontrou 117 desses
-- grupos ainda divididos entre semanas diferentes — o SQL que rodou não corresponde
-- exatamente à versão final do algoritmo (com agrupamento atômico) que ficou no
-- repositório; a causa exata não importa mais do que o fato de estar errado agora.
--
-- Esta migration corrige de forma direta e idempotente: para cada grupo
-- (área+equipamento) onde TODOS os membros compartilham o mesmo tag_kks (ou seja, é
-- inequivocamente o mesmo ativo físico — não um rótulo genérico de categoria
-- compartilhado por TAGs diferentes, que é um caso à parte, não tratado aqui) e que
-- ainda tem membros no backlog com data_inicial divergente entre si, move todos pra a
-- MAIS CEDO das datas já usadas no grupo (nunca atrasa nada que já estava mais perto).
--
-- Não mexe nos 18 grupos restantes onde o "equipamento" é um rótulo de categoria
-- compartilhado por TAGs/ativos físicos diferentes (ex. "ROLOS E PAINEIS", e a maior
-- parte dos casos de ar-condicionado/refrigeração da migration 040) — isso depende de
-- uma decisão de negócio (forçar junto mesmo sendo ativos diferentes, ou manter cada um
-- na sua data real) que ainda não foi confirmada.

UPDATE manutencao_planos SET data_inicial = '2026-09-21' WHERE id = ANY(ARRAY[
    '19a43e27-9c03-4a9f-bb70-5ee82a8d2388',
    'bf5565fd-aafd-466d-959c-4ae894d65563',
    'c8cce003-19e4-46ba-99ff-82da0df5ddac',
    '2c095283-6d84-4ca8-8a36-4e2208d54730',
    'da9794e4-3d4a-4092-86d7-35ebf3945817',
    'fccb9de4-9c05-4ce2-9beb-8138d5a11565',
    '5a103320-2c34-4fe2-a3b2-5f05011f04b5',
    '87b713f1-9ec7-443a-9f40-fae42f4e9719',
    '229c97aa-ca8a-46d8-b626-67965dde835d',
    '273ed9e7-cd08-41f8-a8bb-a352c5d30a67',
    '76e08aad-f488-4064-b0a3-6dcc3a369153',
    'fe53aa80-d110-46ac-923c-b9c44a71627c',
    '89ceb8dd-b422-4bda-8c1e-21d3f8772413',
    '99ef8bad-437b-4e1c-8133-474c4ca23663',
    '5acaba5f-f1a2-443c-8818-2a87d5a76736',
    'fed563a4-5fe4-4525-8361-e9e560cabaee',
    '478bd306-b011-4284-a969-67f9d759c54c',
    'a03e1c8f-93eb-4419-9a35-042378048019',
    'ae5e59cf-73c5-458d-b892-31fc326daef7',
    '9c224ecf-d4e5-40cf-953e-03dc93a82993',
    '211a886a-beef-477c-b2f8-d06818adfaec',
    '51025498-5993-46a9-b70f-ca8f5eea889e',
    'e3a2c611-c24d-4ba7-a945-979105af5ed0',
    'cb888ea1-d96e-4523-8014-e9d3a97650af',
    'ae71d4d0-39db-4e26-a7a0-28c62161ad8a',
    '7ee61352-587e-4320-9752-f6c725f5e328',
    'bbdf332a-0e65-4725-9db0-71609c8c853c',
    'bc777647-dd58-4e69-aba4-b81f2b0f0d37',
    'b9bad777-5298-439c-931d-df772bfa067e',
    '9cbcfebd-79bf-4ebc-94ee-34fd2edc7498',
    'e58af49e-62b0-487b-bee7-c274416d681e',
    'a7be8d35-5a3b-44b1-b171-59b246ffdfb6',
    '04a43c73-c45c-4c0e-9268-0f2abcb9d385',
    '9714812b-2680-4ba7-aef9-dab36eeab28b',
    'b7d63ffd-5167-4321-b8f6-0aa2482efa3f',
    '2d9baf49-81c2-49a2-b52d-d5e36e0bc50e',
    '2416bcee-01f7-4b84-bf37-210337c2ceb4',
    'a3df9e68-f744-40e4-b989-c59db97e3ed0',
    '9eda692e-ec48-4357-9481-71b51bc61204',
    '5c9dd30b-a115-4fa1-b14c-ac663adee3a3',
    'eb240d0b-081f-4d0b-ae1e-411a37d46a83',
    'fa4020ab-929d-4a6c-8487-9eb267a01b0b',
    '38c14873-181c-4c82-9d3b-9750825e04f3',
    '62389f6b-0946-4eeb-9b90-61ea9bf0bb70',
    '1f8db8a9-9781-43cd-bf50-62b0577cffdc',
    '7be718b2-4eb5-4043-9559-f1c6408965ec',
    '761a0d84-adc2-4ae7-ad10-b2d7ae305274',
    '5e048e91-a22d-4dad-8084-9b6d8b0c2e5c',
    'cba824e6-8f02-4c6a-9af6-1898d68ec7ba',
    'dca81cc7-3e8a-4388-b4a6-f956dff44811',
    'd470891b-e0b5-4e74-8823-4b57ebeb97a8',
    '7d937bf2-5db1-4994-8156-91f6430cea3c',
    '31c4c6e0-1864-4f39-9229-9f15b982f8ef',
    'e37c3818-62ac-47aa-80ea-18391b09c9a1',
    '656d9451-3989-4e67-97d6-e05e47fd5b5a',
    '847cedc8-c608-414e-abdb-8166d5129024',
    '11cf1cb6-d41e-4b63-bde5-82cd841d74df',
    '8733f20c-90df-479b-8884-7e418ec007c8',
    '9fdc22cd-21e3-46a3-a395-44e5c1079aa9',
    '1e17a914-68ad-4af1-ae9d-c01ecbe28a92',
    '03779f6d-67d5-4e89-b0c6-e1a2250d86ec',
    '2b7ab252-547c-4782-8f79-d5ee71f9d376',
    '30086002-2f28-4622-a36e-c104fc3fd10e',
    '52f7703f-b413-415c-a308-eba8f35e2ecd',
    '1c8c33c4-ffdf-4ce7-a51a-dbc9013ab6bf',
    '72177ad7-ba8e-444d-8815-af0f0160f247',
    '9eefa090-5649-43f5-a678-05ad0ce244d7',
    'fcd1459a-039f-4c99-bdfb-11b36afed374',
    'f6a5cdf3-66c4-4897-bde0-1c2a89cc402c',
    'fb2bd5f9-1804-4038-8f5a-4337642c88cf',
    'f0e6d0fa-4165-45b3-af57-af633e70aad0',
    '8d098efe-902a-4044-949d-372a1a8e16bf',
    'ebc7926e-57b5-4cbe-8763-2ea1c875b0f6',
    'fbcc4ce5-bdaa-4284-bb0e-c36799ed0291',
    '358b9c59-7816-47a2-9be3-e8a171ded14c',
    'f7949ad1-e435-4e88-811f-dfdcc860834c',
    'f27ed8a4-c7ae-4396-92df-3af20da14fe9',
    'b1dedd0d-2b4f-4f58-aa63-aa183fc28da4',
    'a930063a-0c5d-4cad-a002-44ba5b9b7cbb',
    '741a7d09-0e43-4908-a995-c2f67e1d2d19',
    '7443131b-33f6-4070-82f0-4f6df468aad2',
    'd80692b3-0d58-4c56-883c-fa69c2ce7bbc',
    '758d808f-6dd7-48fa-85fc-f7481c41ea83',
    '4ac8b201-76d4-4ff7-8d27-a385c80b94e1',
    '340ed543-a614-4acc-bc80-fddae5907579',
    '989a5701-b68e-46f9-86c1-6ad6c87e408e'
  ]::uuid[]); -- 86 planos

UPDATE manutencao_planos SET data_inicial = '2026-09-28' WHERE id = ANY(ARRAY[
    '875b9b39-f561-42eb-92cb-5ed2bdcd81c0',
    'fe6e4649-0fee-49f2-b332-15d725cb1abf',
    '74bb7da9-756b-462d-abab-be8780318106',
    '391f6ae3-5f59-47e6-86bf-c04bda851fba',
    '189c0d5a-71e8-4c3b-b04f-2f3087ce9994',
    '8e37493c-b465-4a9e-aedf-f409c2bf7c19',
    '3f9a3c1a-c34f-4dde-bf04-4e3689cd73f5',
    '036bda27-cab4-4432-8929-ef2ede36e259',
    '1327bbf7-6080-4040-9427-fba08d9e9ad0',
    '7dd65050-46f4-456a-85c9-0731be79f05f',
    'f6a461d0-7b39-48f4-9679-bba0244c2820',
    '9c1ff258-52d8-45f9-9c26-9cd88e8cb87e',
    '47893625-51a0-4d61-952b-48fc7264903c',
    'f800a046-f702-4379-a8b4-815bf0afe6d6',
    '31d6e0a5-4483-4920-87ff-c18859131df3',
    'fde12db8-ad54-40ab-b235-9a07180f810c',
    '5a8b0d14-eac9-427a-b7e2-b86b72499dfa',
    'f8df82f1-c79e-49ae-be42-3d0d7e99aa4a',
    'efdb61bd-4e06-4c38-a1e5-6f9b267afbfe',
    'fcfc8203-8f15-44a0-8290-667c0c25c34f',
    'edcd65a7-44d8-4302-b1cc-d3a11389ca08',
    'de4d26ec-d059-4634-a8ba-f745ed30be86',
    '1bb41576-001f-4370-b43a-90a06a2b6990',
    '84584a49-07ae-4a7e-b81f-53536be21570',
    '9e03eaa1-7ed2-4634-8da6-ac964a2c5e46',
    'f00127c4-7f90-4060-9698-0feaf467f74a',
    'f66d5a50-c187-4686-b1ba-a9a04638a194',
    '6fd62ee1-82da-46ef-b622-30b7cb39aa9e',
    '844918d4-abc5-4346-8f51-f51b146c3a66'
  ]::uuid[]); -- 29 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-05' WHERE id = ANY(ARRAY[
    '530b86a6-cc0e-40fc-8a39-cb33cc810c3c',
    '742b3414-1b2c-475d-8904-de45c997cd60',
    'de48023b-6237-47e3-b7b9-d3f8d3ee6e00',
    'f46fdca3-e6dd-4042-8714-362312675b82',
    '1f41a8ff-978b-4205-97cf-b2de89882169',
    'e2d66aa2-d582-41cf-8321-334767c3dd2c',
    '573422c5-4c78-45ea-b96b-242aec895916',
    'b6ce707e-ea6f-4085-b176-f453a29aeb2e',
    '630f6d7a-9dd9-4891-88ba-0eb0cdeb9e2e',
    'f3a6eed4-2655-48c4-a7b6-02d8a1dee6c0',
    '13aa5611-30b2-4851-b97a-3ba62bd1d12e',
    'b95144b1-8e5c-43b8-a823-d7697852913e',
    '80faec84-463b-4dbd-85a4-ded426933934',
    '5d93bd76-1761-4aaa-9aaa-39a953dfb35e',
    '65d4549c-301d-4610-a38a-f56548201734',
    '3653c61f-ca1b-40f6-9e58-b362d2f3337d',
    'fba01e59-6c8c-4694-832e-c4e2ca8ab769',
    '02e7e84c-c21e-45ba-a50a-053056acf2ba',
    '529ec934-e2b2-449c-9c84-1170a9e386e1',
    'a7718aed-43a8-45a5-a09d-a2f127fe7f03',
    '946fe135-e40e-4630-a803-e5024f8a5682',
    '7cce2277-a165-452c-a59f-3ddb994a7b5f',
    'b548a2be-0a2d-40b1-a14c-0ce700dd6b2a',
    '9164ba95-47c5-4046-84ae-a7722450dcf5',
    '54cdcb2b-55b7-4f34-b651-166931da1eb5'
  ]::uuid[]); -- 25 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-12' WHERE id = ANY(ARRAY[
    '45470953-1754-4d1d-a3ba-309037d4881b',
    '6b57ee5f-ef78-4764-a88f-8fedf8dbf9a6',
    '5820fe42-3591-4fe6-87e2-4ae36fb798f2',
    '8d5f38d4-ea0c-486b-8ac4-b9e5201f09c4',
    '62095238-8478-41cf-aaf2-d3fc60e6aff6',
    '1e31f93d-d9cb-49d5-8eb5-b93a732ce458',
    '08303cb6-1786-4b4c-b16c-510a9ccc02a3',
    'f3f3146f-0756-47fe-bef3-974528e87f4c',
    'a5fa83be-00f1-4ce1-98d5-671f66e89763',
    'a38786e8-8b82-4860-a4aa-f88a532d0eb8',
    '3983a3a9-5f85-44ca-acc7-13470e8024ce',
    '68cec49b-8232-483c-ab5c-b48b49763adc',
    'b0cb3c0d-2323-4932-bcb5-44ce8b156dbd',
    'dcc4795b-8ed6-4afb-98d2-5088a0934cc2',
    'b9965de7-e95d-4d06-823b-e0dc7200da27',
    'c11d6e37-031f-4ec2-a50d-88ad34cc5751',
    '5332f9a6-f47e-4c4f-a797-7171b9f79ace',
    '504a8e9f-f692-4839-adcb-ccb6bedab471',
    'eacd5a8c-9661-4c27-a5f1-fe4ad34b59c2',
    '3fa44b71-bc06-4f0f-9f81-d79e21a7ffa0',
    '4eccfc44-0007-4646-8cb7-b504993bbbcb'
  ]::uuid[]); -- 21 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-19' WHERE id = ANY(ARRAY[
    '24b6a9c6-7638-40a8-ab5c-c1cd8d05ce5e',
    '2005a504-f79c-4ef0-9f55-9e570aeb100d',
    'eb32d183-cebd-44ee-8671-c34adf9bb6f7',
    'edf5a361-4659-4f00-b3b5-237df7817074',
    '453905bb-297e-4f10-9151-91692addb8b3',
    'a98d3b96-6633-40ec-8107-47132c7b3998',
    '1012ae8d-d9a9-43f5-8411-2a791e0d0985',
    '039f9974-81f2-4084-86a2-992592b07e13',
    '8bc95900-494e-47aa-818e-99a3782b89ad',
    '371052b1-89eb-444e-b777-62ff072f92d0',
    '2a8f0f8f-9004-4e60-81ea-74a543a1340b',
    '707a63e1-7428-42d0-ae77-55f8522edff2',
    'c628377d-441b-4c25-91e5-51f519d89ae4',
    '64b9458b-5ca6-4a53-a83b-eae16d92ece3',
    '68e3e533-c8e0-4955-a2b1-99a43c3ff6a4',
    '12c9fa4a-cbd0-4da6-a606-d638734ba94c',
    'd62ea49e-260f-437b-aecc-abc1e2ee2bf5',
    '6b349159-d754-4666-b873-bf1e20d983e0',
    'c870ec87-2fe8-40d3-8fa1-df1473020091',
    '7806a9c4-572b-41c5-bffa-3125664b88e4',
    '6f855798-61c6-4f90-b418-8b82c1ed157a',
    '99d89db5-7040-47aa-b508-f029f8c46502',
    '57920efd-574d-42f3-b42f-be6ad69c2006',
    'ab748c50-d1e9-4b60-a980-15bb3174054a',
    '426a6cb7-3052-460d-b92d-8e4a622229b6'
  ]::uuid[]); -- 25 planos

UPDATE manutencao_planos SET data_inicial = '2026-10-26' WHERE id = ANY(ARRAY[
    '5ab49524-3e6c-43c5-935f-60dc560a41e3',
    '702600c6-abaa-4862-aae9-e28ad84f75c3',
    '97f4117b-5818-44e4-9d37-bf5e84bf856c',
    '8d998555-36c6-4a8e-944e-1cb867d50910',
    '24dca0db-9cba-48f5-9b1d-7170d4fed5fc',
    '372715b1-f2e9-4ad9-a052-d88bc31c93f3',
    '105a2d89-a659-4f2a-97b2-06fd8ec4b9eb',
    '14c8ee75-1303-42ce-9f99-1d0abaad776b',
    'af31f16d-1b7b-484d-8fda-4453d6bf54fc',
    '9c3e5f8c-0428-4381-a97f-6a9367bae4ad',
    'f5e357de-399e-4b9a-b3e4-22c506a45af0',
    '062ba1e1-9646-4cca-9e02-b8084c211a97',
    'be4e4592-48f5-467b-ac87-9c34eaeface6',
    '88413928-dc08-494c-b0b2-f9e045df8e97',
    '1ec45da2-9ba9-40bd-815d-c1a5e201a052',
    '615b4698-1bb1-4d0a-90e6-7cace660456f'
  ]::uuid[]); -- 16 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-02' WHERE id = ANY(ARRAY[
    '68941378-c0ab-4cfb-88be-7a481697a5cc',
    '9432f975-7121-424b-b4fc-30b6e42953dc',
    'f50e0415-90f9-446a-a08c-be58a7aee68b',
    'abf849b9-852e-4a1a-a15d-0ac5b75c955d',
    'a6f0624b-fd86-424b-b520-4b6b2e8cd955',
    '381900f5-19e1-45a2-b558-0497fde55a5d',
    '646f1917-0bc1-4ca3-b8ad-e375d7f726da',
    '898c72cf-a150-4c1f-ae31-377737d2380b',
    '1ea348c4-b002-4e1c-b8b0-69cf5c0d6e3c'
  ]::uuid[]); -- 9 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-09' WHERE id = ANY(ARRAY[
    'daba104b-2daf-4a94-95a4-f801127ec7f8',
    '1ea4fa9a-1ad6-4c8c-9e80-40e2375a515d',
    'd243a9cc-3920-41c7-9c02-1569d58ab610',
    '996c1d69-00ad-4928-8424-e02aafcb0780',
    'e94f37ad-620a-493d-b47d-0c2544ba82ad',
    'af969629-2791-4195-9aaa-e7917eb9c8a7',
    'e560be22-6ecc-40f8-b09b-5c77fca67750',
    'f658ddb5-61e6-47c1-aa45-6960c77863b4',
    '1868aa16-5676-429e-801c-4aa5f712c654',
    '004e02de-23dc-4b79-896e-f7ffa014c37d',
    '1b82e45f-9e28-44ab-bb5f-bc4b8fe31108',
    'e213c3e8-f6bd-4db2-bbd9-f6881474aa82',
    'dc7e405f-478a-4159-8ed2-0bb3418ae0d5',
    'fc702cb6-f374-47b0-9d3f-32dff6483342',
    '01dfb051-b758-44fe-a6cf-80f56962af87',
    '5bf8d31f-eb64-40dd-9d83-6867fc3e1256'
  ]::uuid[]); -- 16 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-16' WHERE id = ANY(ARRAY[
    '9a18b010-dc79-48d3-8149-2663dbb7fbe9',
    'e9b0e477-1013-4af5-a34b-2a26eecf4f8f',
    '0d921415-00d0-43d4-82b2-0d08a5194507',
    '20836bff-ac99-41e2-8a39-2d4ae04b3e07',
    'bcc33afc-c2cc-43db-b581-e1bd117d142a',
    '5d67df22-7cc7-4d2c-a379-5de05d11df89',
    '00f854c9-37ee-4cf7-8eac-ceff6a349f88',
    'cd40e3ca-ca92-4e6d-8a6a-b2daac7659b5',
    'ab6abd54-c8df-4fbf-afe7-d0febb76f1f9',
    '1b51890d-0cf8-4af5-b942-e9901046103b'
  ]::uuid[]); -- 10 planos

UPDATE manutencao_planos SET data_inicial = '2026-11-23' WHERE id = ANY(ARRAY[
    '0d683d3c-9284-466b-aebc-892ed613a6a5',
    'd4b7cfca-a1e4-4c7a-8027-4499a07634f7',
    'a90ed4a0-215c-4267-8a83-cd3e2fa849fc',
    '3260141f-6860-49ec-8894-1076a383ba83',
    'c45e5c4b-98f4-4d9e-97ff-309a80b6a365',
    '01eeacfb-4928-41e9-95d7-7b90d8728be3',
    'cb8cd886-8f7f-4eeb-8d37-ec1e81c020f9'
  ]::uuid[]); -- 7 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-07' WHERE id = ANY(ARRAY[
    'c241f822-81b1-47c4-912b-2af90104f149',
    'bc91eab4-2e13-4c8a-9b8f-254af2130d26'
  ]::uuid[]); -- 2 planos

UPDATE manutencao_planos SET data_inicial = '2026-12-14' WHERE id = ANY(ARRAY[
    '30712abc-de9b-47a4-9aa8-5eac91d131b5',
    'f8c0f5cc-b949-4f19-8272-4049b35bcacc'
  ]::uuid[]); -- 2 planos

