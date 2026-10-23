import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const admin = '00000000-0000-4000-8000-000000000001';
const solicitante = '00000000-0000-4000-8000-000000000002';
const visualizador = '00000000-0000-4000-8000-000000000003';
async function login(id, role = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [id, role]);
  await db.exec(`SET ROLE ${role}`);
}
before(async () => {
  db = new PGlite();
  // Fixtures representam os pré-requisitos legados; não são um baseline de produção.
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    CREATE PUBLICATION supabase_realtime;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE TABLE materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, updated_at timestamptz DEFAULT now());
    CREATE TABLE profiles(id uuid PRIMARY KEY, name text, email text, role text, department text, position text, must_change_password boolean DEFAULT false);
    INSERT INTO profiles(id,name,role) VALUES ('${admin}','Admin','Admin'), ('${solicitante}','Solicitante','Solicitante'), ('${visualizador}','Visualizador','Visualizador');
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text, event_type text, resource_type text, resource_id text, description text, metadata jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE purchase_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requester_id uuid REFERENCES profiles(id), status text, requestdate timestamptz DEFAULT now(), history jsonb DEFAULT '[]');
    ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Allow update requests" ON purchase_requests FOR UPDATE USING (true) WITH CHECK (true);
    CREATE FUNCTION get_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT COALESCE((SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1), 'Solicitante') $$;
    CREATE FUNCTION get_user_role(user_id uuid) RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER AS
      $$ SELECT role FROM profiles WHERE id = user_id $$;
  `);
  const migrations = await readdir('supabase/migrations');
  const prerequisites = new Set([36,37,43,44,46,49,50,51,52,53]);
  for (const file of migrations.sort()) {
    const n = Number(file.slice(0,3));
    if ((n >= 6 && n <= 32) || prerequisites.has(n) || n >= 54) {
      try { await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8')); }
      catch (error) { throw new Error(`${file}: ${error.message}`); }
      // Cada migration roda numa sessão nova do SQL Editor; sem isso, funções pg_temp
      // de uma (ex.: 060) vazam pra próxima e ela falha ao recriar.
      await db.exec('DISCARD TEMP');
    }
  }
  await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;`);
});
after(async () => { await db?.close(); });

test('solicitante cria pedido próprio, mas não aprova nem se torna Admin', async () => {
  await login(solicitante);
  const { rows: [row] } = await db.query(`INSERT INTO fundo_fixo_solicitacoes(solicitante_id,solicitante_nome,setor,material,mes_referencia)
    VALUES ($1,'Teste','Manutenção','Material','2026-09') RETURNING id`, [solicitante]);
  await assert.rejects(db.query("UPDATE fundo_fixo_solicitacoes SET status='aprovado' WHERE id=$1", [row.id]), /administrador/);
  await assert.rejects(db.query("UPDATE profiles SET role='Admin' WHERE id=$1", [solicitante]), /administrativos/);
  await login(admin);
  await db.query("UPDATE fundo_fixo_solicitacoes SET status='aprovado', aprovador_id=$1 WHERE id=$2", [admin, row.id]);
  await login(solicitante);
  await db.query("UPDATE fundo_fixo_solicitacoes SET status='comprado',valor_final=15 WHERE id=$1", [row.id]);
  await assert.rejects(db.query("UPDATE fundo_fixo_solicitacoes SET valor_final=1 WHERE id=$1", [row.id]), /administrativos/);
});

test('Visualizador não grava pagamentos, apontamentos ou programação', async () => {
  await login(visualizador);
  await assert.rejects(db.query("INSERT INTO fundo_fixo_saques(valor,registrado_por_nome,mes_referencia) VALUES (20,'Teste','2026-09')"), /row-level security/);
  await assert.rejects(db.query("INSERT INTO apontamentos(data) VALUES ('2026-09-01')"), /row-level security/);
  await assert.rejects(db.query("INSERT INTO manutencao_programacao(area,semana_inicio,descricao,tecnico_nome,criado_por_nome) VALUES ('ELETRICA','2026-09-21','Teste','Teste','Teste')"), /row-level security/);
});

test('importação almox é atômica, rejeita vazio e não pode ser chamada pelo navegador', async () => {
  await login(solicitante);
  await assert.rejects(db.query("SELECT importar_almox_atomico('saldo','[]','teste',$1)", [admin]), /permission denied/);
  await login(admin, 'service_role');
  const valid = [{ produto_codigo: 'TESTE', saldo_qtd: 5, custo_medio: 2 }];
  await db.query("SELECT importar_almox_atomico('saldo',$1,'teste',$2)", [JSON.stringify(valid), admin]);
  await assert.rejects(db.query("SELECT importar_almox_atomico('saldo','[]','teste',$1)", [admin]), /vazio/);
  await assert.rejects(db.query("SELECT importar_almox_atomico('saldo',$1,'teste',$2)", [JSON.stringify([{ produto_codigo: 'X', saldo_qtd: 'invalido' }]), admin]));
  const { rows } = await db.query('SELECT produto_codigo, saldo_qtd FROM almox_saldo_real');
  assert.equal(rows.length, 1); assert.equal(rows[0].produto_codigo, 'TESTE'); assert.equal(Number(rows[0].saldo_qtd), 5);
  const { rows: [log] } = await db.query("SELECT count(*)::integer AS n FROM almox_importacoes WHERE tipo='saldo'");
  assert.equal(log.n, 1);
});

test('importação de apontamentos substitui somente dias presentes e reverte falhas', async () => {
  await login(admin);
  await db.query("INSERT INTO apontamentos(data,executante) VALUES ('2026-09-01','ANTIGO'), ('2026-09-02','PRESERVADO')");
  const incoming = [{ data: '2026-09-01', executante: 'NOVO', horas: 2 }];
  await db.query("SELECT importar_apontamentos_atomico($1,'teste')", [JSON.stringify(incoming)]);
  await assert.rejects(db.query("SELECT importar_apontamentos_atomico($1,'teste')", [JSON.stringify([{ ...incoming[0], horas: 'invalido' }])]));
  const { rows } = await db.query('SELECT executante FROM apontamentos ORDER BY data');
  assert.deepEqual(rows.map(r => r.executante), ['NOVO', 'PRESERVADO']);
  await login(solicitante);
  await assert.rejects(db.query("SELECT importar_apontamentos_atomico($1,'teste')", [JSON.stringify(incoming)]), /administradores/);
});

test('semana fechada impede criação por Solicitante; Admin consegue operar', async () => {
  await login(admin);
  await db.query("INSERT INTO manutencao_semanas_fechadas(semana_inicio,fechado_por_nome) VALUES ('2026-09-21','Admin')");
  await login(solicitante);
  await assert.rejects(db.query("INSERT INTO manutencao_programacao(area,semana_inicio,descricao,tecnico_nome,criado_por_nome) VALUES ('ELETRICA','2026-09-21','Teste','Teste','Teste')"), /row-level security/);
  await login(admin);
  await db.query("INSERT INTO manutencao_programacao(area,semana_inicio,descricao,tecnico_nome,criado_por_nome) VALUES ('ELETRICA','2026-09-21','Teste','Teste','Teste')");
});


test('solicitante reserva número de OS, mas não altera cadastro do plano', async () => {
  await login(admin);
  const { rows: [plano] } = await db.query("INSERT INTO manutencao_planos(nome,equipamento,area,descricao,periodicidade_valor,periodicidade_unidade,data_inicial,criado_por_nome) VALUES ('Teste','M01','MECANICA','Teste',1,'Semana(s)','2026-09-21','Admin') RETURNING id");
  await login(solicitante);
  await db.query("UPDATE manutencao_planos SET numero_os_reservado='123' WHERE id=$1", [plano.id]);
  await assert.rejects(db.query("UPDATE manutencao_planos SET periodicidade_valor=99 WHERE id=$1", [plano.id]), /cadastro do plano/);
});

test('data de liberação permanece estável quando o material é editado', async () => {
  await login(admin);
  const { rows: [material] } = await db.query("INSERT INTO materials(status) VALUES ('pendente') RETURNING id,released_at");
  assert.equal(material.released_at, null);
  const { rows: [released] } = await db.query("UPDATE materials SET status='liberado' WHERE id=$1 RETURNING released_at", [material.id]);
  assert.ok(released.released_at);
  const { rows: [edited] } = await db.query("UPDATE materials SET updated_at=now(), released_at='2000-01-01' WHERE id=$1 RETURNING released_at", [material.id]);
  assert.deepEqual(edited.released_at, released.released_at);
});

test('ordem e ciclo são atômicos; trocar/desvincular plano remove o ciclo anterior', async () => {
  await login(admin);
  const { rows: planos } = await db.query("INSERT INTO manutencao_planos(nome,equipamento,area,descricao,periodicidade_valor,periodicidade_unidade,data_inicial,criado_por_nome) VALUES ('A','M01','MECANICA','A',1,'Semana(s)','2026-09-28','Admin'), ('B','M02','MECANICA','B',1,'Semana(s)','2026-09-28','Admin') RETURNING id");
  await login(solicitante);
  const { rows: [ordem] } = await db.query("INSERT INTO manutencao_programacao(area,semana_inicio,descricao,tecnico_nome,criado_por_nome,plano_preventivo_id,ciclo_data_prevista) VALUES ('MECANICA','2026-09-28','Teste','Teste','Teste',$1,'2026-09-28') RETURNING id", [planos[0].id]);
  const ciclos = async () => (await db.query('SELECT plano_id,ordem_id FROM manutencao_ciclos WHERE ordem_id=$1', [ordem.id])).rows;
  assert.deepEqual(await ciclos(), [{ plano_id: planos[0].id, ordem_id: ordem.id }]);
  await assert.rejects(db.query("UPDATE manutencao_programacao SET plano_preventivo_id=$1, ciclo_data_prevista=null WHERE id=$2", [planos[1].id, ordem.id]), /data do ciclo/);
  assert.deepEqual(await ciclos(), [{ plano_id: planos[0].id, ordem_id: ordem.id }]);
  await db.query("UPDATE manutencao_programacao SET plano_preventivo_id=$1, ciclo_data_prevista='2026-10-05' WHERE id=$2", [planos[1].id, ordem.id]);
  assert.deepEqual(await ciclos(), [{ plano_id: planos[1].id, ordem_id: ordem.id }]);
  await db.query('UPDATE manutencao_programacao SET plano_preventivo_id=null WHERE id=$1', [ordem.id]);
  assert.deepEqual(await ciclos(), []);
});

test('fundo fixo: cada solicitação nova recebe o próximo número de chamado', async () => {
  await login(solicitante);
  const inserir = () => db.query(`INSERT INTO fundo_fixo_solicitacoes(solicitante_id,solicitante_nome,setor,material,mes_referencia)
    VALUES ($1,'Teste','Manutenção','Material','2026-10') RETURNING numero`, [solicitante]);
  const { rows: [a] } = await inserir();
  const { rows: [b] } = await inserir();
  assert.ok(Number(a.numero) > 0);
  assert.equal(Number(b.numero), Number(a.numero) + 1);
});

test('reparo externo: qualquer um abre em nome próprio; só supervisor de elétrica muda status, com histórico', async () => {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', '', false)"); // como no SQL Editor: sem usuário
  await db.query("UPDATE profiles SET supervisor_eletrica = true WHERE id = $1", [visualizador]);
  const abrir = (dono, extra = '') => db.query(`INSERT INTO eletrica_reparos(solicitante_id,solicitante_nome,equipamento,resumo,servico_solicitado${extra ? ',status' : ''})
    VALUES ($1,'Teste','PanelView','Não liga','Reparo'${extra ? `,'${extra}'` : ''}) RETURNING id, numero, status`, [dono]);

  await login(solicitante);
  const { rows: [r] } = await abrir(solicitante);
  assert.equal(r.status, 'aberto');
  assert.ok(Number(r.numero) > 0);
  await assert.rejects(abrir(admin), /row-level security/);
  await assert.rejects(abrir(solicitante, 'concluido'), /aberta/);
  // Quem abriu não muda o status (RLS: 0 linhas, sem erro).
  const { rows: nada } = await db.query("UPDATE eletrica_reparos SET status='concluido' WHERE id=$1 RETURNING id", [r.id]);
  assert.equal(nada.length, 0);

  await login(visualizador);
  await db.query("UPDATE eletrica_reparos SET status='em_reparo', status_observacao='Enviado', fornecedor='Rockwell' WHERE id=$1", [r.id]);
  const { rows: hist } = await db.query('SELECT status, observacao FROM eletrica_reparos_historico WHERE reparo_id=$1 ORDER BY created_at, status', [r.id]);
  assert.deepEqual(hist.map(h => h.status).sort(), ['aberto', 'em_reparo']);
  assert.equal(hist.find(h => h.status === 'em_reparo').observacao, 'Enviado');
  await assert.rejects(db.query("INSERT INTO eletrica_reparos_historico(reparo_id,status) VALUES ($1,'concluido')", [r.id]), /row-level security/);
});

test('ensaios de motores: qualquer um cadastra e lança; só quem lançou corrige; só Admin exclui', async () => {
  const cadastrar = (dono, tag) => db.query(`INSERT INTO eletrica_equipamentos(tag,tensao_v,classe_isolamento,tipo_bobina,criado_por_id)
    VALUES ($1,6300,'F','pre_formada',$2) RETURNING id`, [tag, dono]);
  const lancar = (motor, dono) => db.query(`INSERT INTO eletrica_ensaios(equipamento_id,data_ensaio,tensao_aplicada_v,temperatura_ambiente_c,
      tensao_nominal_v,classe_isolamento,tipo_bobina,medicoes,resultado,criado_por_id,criado_por_nome)
    VALUES ($1,'2026-10-21',5000,30,6300,'F','pre_formada','[{"circuito":"A","r1min":975}]','aprovado',$2,'Teste') RETURNING id, numero`, [motor, dono]);

  await login(visualizador);
  const { rows: [m] } = await cadastrar(visualizador, '91ECA42AF001');
  // TAG não repete, nem com outra caixa/espaço.
  await assert.rejects(cadastrar(visualizador, ' 91eca42af001 '), /uq_eletrica_equipamentos_tag/);
  await assert.rejects(cadastrar(admin, 'OUTRO'), /row-level security/);
  const { rows: [e] } = await lancar(m.id, visualizador);
  assert.ok(Number(e.numero) > 0);
  await assert.rejects(lancar(m.id, solicitante), /row-level security/);

  // Outro usuário edita o motor, mas não corrige o ensaio alheio (RLS: 0 linhas).
  await login(solicitante);
  const { rows: editado } = await db.query("UPDATE eletrica_equipamentos SET local_instalacao='TT24' WHERE id=$1 RETURNING id", [m.id]);
  assert.equal(editado.length, 1);
  const { rows: nada } = await db.query("UPDATE eletrica_ensaios SET resultado='reprovado' WHERE id=$1 RETURNING id", [e.id]);
  assert.equal(nada.length, 0);
  const { rows: semExcluir } = await db.query('DELETE FROM eletrica_ensaios WHERE id=$1 RETURNING id', [e.id]);
  assert.equal(semExcluir.length, 0);

  // Quem lançou corrige, mas não troca o dono nem o número.
  await login(visualizador);
  await db.query("UPDATE eletrica_ensaios SET resultado='reprovado' WHERE id=$1", [e.id]);
  await assert.rejects(db.query('UPDATE eletrica_ensaios SET criado_por_id=$2 WHERE id=$1', [e.id, solicitante]), /trocar/);

  // Admin exclui o motor e os ensaios saem junto.
  await login(admin);
  await db.query('DELETE FROM eletrica_equipamentos WHERE id=$1', [m.id]);
  const { rows: sobra } = await db.query('SELECT id FROM eletrica_ensaios WHERE id=$1', [e.id]);
  assert.equal(sobra.length, 0);
});

test('ensaios de transformador: placa obrigatória e ensaio só no tipo certo de equipamento', async () => {
  await login(solicitante);
  const sec = JSON.stringify([{ nome: '1X', tensaoV: 690, ligacao: 'D' }, { nome: '2X', tensaoV: 690, ligacao: 'Y' }]);
  const { rows: [t] } = await db.query(`INSERT INTO eletrica_equipamentos(tipo,tag,tensao_v,classe_isolamento,ligacao_primaria,secundarios,
      meio_isolante,material_enrolamento,criado_por_id) VALUES ('transformador','TC-05',13800,'F','D',$1,'seco','cobre',$2) RETURNING id`, [sec, solicitante]);
  // Trafo sem secundário e motor sem tipo de bobina não passam.
  await assert.rejects(db.query(`INSERT INTO eletrica_equipamentos(tipo,tag,tensao_v,classe_isolamento,ligacao_primaria,secundarios,
      meio_isolante,material_enrolamento,criado_por_id) VALUES ('transformador','TC-06',13800,'F','D','[]','seco','cobre',$1)`, [solicitante]), /placa_trafo/);
  await assert.rejects(db.query(`INSERT INTO eletrica_equipamentos(tag,tensao_v,classe_isolamento,criado_por_id)
      VALUES ('M-SEM-BOBINA',440,'F',$1)`, [solicitante]), /placa_motor/);

  const criterio = JSON.stringify({ tensaoPrimariaV: 13800, tapTensaoV: 13800, ligacaoPrimaria: 'D', secundarios: JSON.parse(sec),
    meioIsolante: 'seco', materialEnrolamento: 'cobre', classeIsolamento: 'F' });
  const lancarTrafo = (equip) => db.query(`INSERT INTO eletrica_ensaios(tipo,equipamento_id,data_ensaio,tensao_aplicada_v,temperatura_ambiente_c,
      tensao_nominal_v,classe_isolamento,criterio,medicoes,ohmica,ttr,resultado,criado_por_id,criado_por_nome)
    VALUES ('transformador',$1,'2026-09-04',5000,25,13800,'F',$2,'[]','[]','[]','aprovado',$3,'Teste') RETURNING id, numero`, [equip, criterio, solicitante]);
  const { rows: [e] } = await lancarTrafo(t.id);
  assert.ok(Number(e.numero) > 0);
  // Ensaio de trafo sem critério, e ensaio de motor apontando pro trafo, não passam.
  await assert.rejects(db.query(`INSERT INTO eletrica_ensaios(tipo,equipamento_id,data_ensaio,tensao_aplicada_v,temperatura_ambiente_c,
      tensao_nominal_v,classe_isolamento,resultado,criado_por_id,criado_por_nome)
    VALUES ('transformador',$1,'2026-09-04',5000,25,13800,'F','aprovado',$2,'Teste')`, [t.id, solicitante]), /criterio_tipo/);
  await assert.rejects(db.query(`INSERT INTO eletrica_ensaios(equipamento_id,data_ensaio,tensao_aplicada_v,temperatura_ambiente_c,
      tensao_nominal_v,classe_isolamento,tipo_bobina,resultado,criado_por_id,criado_por_nome)
    VALUES ($1,'2026-09-04',5000,25,13800,'F','pre_formada','aprovado',$2,'Teste')`, [t.id, solicitante]), /não corresponde/);
  const { rows: [m] } = await db.query(`INSERT INTO eletrica_equipamentos(tag,tensao_v,classe_isolamento,tipo_bobina,criado_por_id)
      VALUES ('M-01',6300,'F','pre_formada',$1) RETURNING id`, [solicitante]);
  await assert.rejects(lancarTrafo(m.id), /não corresponde/);

  // 082: situação nasce 'instalado' e só aceita instalado/reserva.
  const { rows: [sit] } = await db.query('SELECT situacao FROM eletrica_equipamentos WHERE id=$1', [m.id]);
  assert.equal(sit.situacao, 'instalado');
  await db.query("UPDATE eletrica_equipamentos SET situacao='reserva', aplicacao='M-02 e M-03' WHERE id=$1", [m.id]);
  await assert.rejects(db.query("UPDATE eletrica_equipamentos SET situacao='sucata' WHERE id=$1", [m.id]), /situacao_check/);
});

test('equipamentos: histórico por trigger, troca instalado x reserva e termografia em qualquer tipo', async () => {
  await login(visualizador);
  const motor = (tag, situacao, aplicacao, local) => db.query(`INSERT INTO eletrica_equipamentos(tag,tensao_v,classe_isolamento,tipo_bobina,
      situacao,aplicacao,local_instalacao,criado_por_id) VALUES ($1,440,'F','randomica',$2,$3,$4,$5) RETURNING id`,
    [tag, situacao, aplicacao, local, visualizador]);
  const { rows: [a] } = await motor('BOMBA-A', 'instalado', 'Bomba de água A', 'Casa de bombas');
  const { rows: [r] } = await motor('RES-01', 'reserva', 'Bombas A e B', 'Almoxarifado');
  const hist = async (id) => (await db.query(
    'SELECT situacao_anterior, situacao_nova, aplicacao_nova, local_novo, troca_id, substituto_tag, motivo FROM eletrica_equipamentos_movimentos WHERE equipamento_id=$1 ORDER BY created_at, situacao_nova', [id])).rows;
  assert.equal((await hist(a.id))[0].motivo, 'Cadastro');
  // Histórico não é gravável pelo app.
  await assert.rejects(db.query("INSERT INTO eletrica_equipamentos_movimentos(equipamento_id,situacao_nova) VALUES ($1,'reserva')", [a.id]), /row-level security/);

  // Troca: a reserva assume aplicação e local; o instalado vira reserva no local informado.
  await db.query("SELECT eletrica_trocar_equipamentos($1,$2,'Oficina elétrica','2026-10-21','Rolamento travado')", [a.id, r.id]);
  const { rows: depois } = await db.query('SELECT id, situacao, aplicacao, local_instalacao FROM eletrica_equipamentos WHERE id IN ($1,$2)', [a.id, r.id]);
  const ra = depois.find(x => x.id === a.id);
  const rr = depois.find(x => x.id === r.id);
  assert.deepEqual([ra.situacao, ra.aplicacao, ra.local_instalacao], ['reserva', 'Bomba de água A', 'Oficina elétrica']);
  assert.deepEqual([rr.situacao, rr.aplicacao, rr.local_instalacao], ['instalado', 'Bomba de água A', 'Casa de bombas']);
  const [ha, hr] = [(await hist(a.id)).at(-1), (await hist(r.id)).at(-1)];
  assert.equal(ha.substituto_tag, 'RES-01');
  assert.equal(hr.substituto_tag, 'BOMBA-A');
  assert.equal(ha.motivo, 'Rolamento travado');
  assert.ok(ha.troca_id && ha.troca_id === hr.troca_id);
  // Edição comum depois da troca não herda motivo/troca (set_config é local à transação).
  await db.query("UPDATE eletrica_equipamentos SET local_instalacao='Almoxarifado' WHERE id=$1", [a.id]);
  const ultimo = (await hist(a.id)).at(-1);
  assert.equal(ultimo.troca_id, null);
  assert.equal(ultimo.motivo, null);
  // Troca ao contrário (reserva saindo) é recusada.
  await assert.rejects(db.query("SELECT eletrica_trocar_equipamentos($1,$2,'x',null,null)", [a.id, r.id]), /instalado por uma reserva/);

  // Termografia: sem tensão de ensaio, em motor; isolamento continua exigindo os campos.
  const { rows: [t] } = await db.query(`INSERT INTO eletrica_ensaios(tipo,equipamento_id,data_ensaio,temperatura_ambiente_c,criterio,medicoes,resultado,
      anexos,criado_por_id,criado_por_nome) VALUES ('termografia',$1,'2026-10-21',30,'{"cargaPct":80}','[]','aprovado',
      '[{"url":"x","nome":"ir.jpg","tipo":"imagem","legenda":""}]',$2,'Teste') RETURNING id`, [r.id, visualizador]);
  assert.ok(t.id);
  await assert.rejects(db.query(`INSERT INTO eletrica_ensaios(equipamento_id,data_ensaio,temperatura_ambiente_c,tipo_bobina,resultado,criado_por_id,criado_por_nome)
      VALUES ($1,'2026-10-21',30,'randomica','aprovado',$2,'Teste')`, [r.id, visualizador]), /criterio_tipo/);
  await assert.rejects(db.query(`INSERT INTO eletrica_ensaios(tipo,equipamento_id,data_ensaio,temperatura_ambiente_c,criterio,resultado,anexos,criado_por_id,criado_por_nome)
      VALUES ('termografia',$1,'2026-10-21',30,'{}','aprovado','{}',$2,'Teste')`, [r.id, visualizador]), /anexos_check/);
});

test('SC: solicitante edita só a própria Pendente; visualizador não grava; só Admin exclui', async () => {
  await login(solicitante);
  const { rows: [sc] } = await db.query("INSERT INTO purchase_requests(requester_id,status) VALUES ($1,'Pendente') RETURNING id", [solicitante]);
  await assert.rejects(db.query("INSERT INTO purchase_requests(requester_id,status) VALUES ($1,'Pendente')", [admin]), /row-level security/);
  assert.equal((await db.query("UPDATE purchase_requests SET status='Pendente' WHERE id=$1", [sc.id])).affectedRows, 1);

  await login(visualizador);
  assert.equal((await db.query("UPDATE purchase_requests SET status='Finalizado' WHERE id=$1", [sc.id])).affectedRows, 0);
  assert.equal((await db.query('SELECT id FROM purchase_requests WHERE id=$1', [sc.id])).rows.length, 1);

  await login(admin);
  await db.query("UPDATE purchase_requests SET status='Aprovado no Portal' WHERE id=$1", [sc.id]);
  await login(solicitante);
  assert.equal((await db.query("UPDATE purchase_requests SET status='Finalizado' WHERE id=$1", [sc.id])).affectedRows, 0);
  assert.equal((await db.query('DELETE FROM purchase_requests WHERE id=$1', [sc.id])).affectedRows, 0);
  await login(admin);
  assert.equal((await db.query('DELETE FROM purchase_requests WHERE id=$1', [sc.id])).affectedRows, 1);
});

test('auditoria: limpeza apaga o que passou de 30 dias, menos o histórico de cadastro dos planos', async () => {
  await db.exec('RESET ROLE');
  await db.exec(`DELETE FROM audit_logs;
    INSERT INTO audit_logs(user_name,event_type,resource_type,description,created_at) VALUES
      ('A','request_updated','request','velho', now() - interval '31 days'),
      ('A','request_updated','request','novo', now() - interval '29 days'),
      ('A','manutencao_plano_editado','manutencao_planos','plano velho', now() - interval '400 days'),
      ('A','manutencao_plano_checklist_replicado','manutencao_planos_x','replicado velho', now() - interval '400 days');`);
  const { rows: [{ limpar_audit_logs: apagados }] } = await db.query('SELECT public.limpar_audit_logs()');
  assert.equal(apagados, 1);
  const { rows } = await db.query('SELECT description FROM audit_logs ORDER BY description');
  assert.deepEqual(rows.map(r => r.description), ['novo', 'plano velho', 'replicado velho']);
});
