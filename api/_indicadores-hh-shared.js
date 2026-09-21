const normalizar = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const INATIVO = { 'ALEXANDRE GOMES': '2026-09-14', 'JOAQUIM NETO': '2026-08-24' };
const round = value => Math.round(value * 100) / 100;

// Somente totais semanais saem do servidor. Datas/motivos de afastamento e
// lançamentos individuais de folga/exame não fazem parte da resposta pública.
export function resumirDisponibilidade(ordens, afastamentos, colaboradores, anos) {
  const resultado = {};
  const tecnicos = colaboradores.filter(c => /ELETR|MECAN/.test(normalizar(c.area)));
  const daPessoa = (registro, c) => registro.tecnicoMatricula
    ? String(registro.tecnicoMatricula).trim() === String(c.matricula).trim()
    : normalizar(registro.tecnicoNome) === normalizar(c.nome);
  for (const ano of new Set(anos)) {
    const cursor = new Date(Date.UTC(ano, 0, 1));
    cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
    while (cursor.getUTCFullYear() <= ano) {
      const semana = cursor.toISOString().slice(0, 10);
      const ordensSemana = ordens.filter(o => o.semanaInicio === semana);
      let bruto = 0, liquido = 0;
      const porTecnico = {};
      for (const c of tecnicos) {
        const corte = INATIVO[normalizar(c.nome)];
        if (corte && semana >= corte) continue;
        const ausencias = afastamentos.filter(a => daPessoa(a, c));
        const folgas = new Set(ordensSemana.filter(o => o.tipo === 'folga' && daPessoa(o, c)).flatMap(o => o.diasPrevistos));
        let disponivel = 0;
        for (let i = 0; i < 5; i++) {
          const data = new Date(cursor); data.setUTCDate(data.getUTCDate() + i);
          const iso = data.toISOString().slice(0, 10);
          const base = c.disponibilidade ?? 6.5;
          const horas = iso >= '2026-06-01' ? (c.disponibilidade_pos_corte ?? base) : base;
          bruto += horas;
          if (!folgas.has(iso) && !ausencias.some(a => a.dataInicio <= iso && a.dataFim >= iso)) disponivel += horas;
        }
        porTecnico[String(c.matricula).trim()] = round(disponivel);
        liquido += disponivel;
      }
      resultado[semana] = {
        disponivel: round(liquido), indisponivel: round(bruto - liquido), porTecnico,
        exames: ordensSemana.filter(o => o.tipo === 'exame_medico').length,
        folgas: ordensSemana.filter(o => o.tipo === 'folga').reduce((n, o) => n + o.diasPrevistos.length, 0),
      };
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  return resultado;
}
