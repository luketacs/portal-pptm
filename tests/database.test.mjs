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
  `);
  const migrations = await readdir('supabase/migrations');
  const prerequisites = new Set([36,37,43,44,46,49,50,51,52,53]);
  for (const file of migrations.sort()) {
    const n = Number(file.slice(0,3));
    if ((n >= 6 && n <= 32) || prerequisites.has(n) || n >= 54) {
      try { await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8')); }
      catch (error) { throw new Error(`${file}: ${error.message}`); }
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
