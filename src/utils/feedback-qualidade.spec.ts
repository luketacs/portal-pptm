import {
  ApontamentoFeedback, agruparPor, extrairCamposPadrao, avaliarFeedbacks, contarMotivos, mencionaPendencia,
  normalizarTexto, numerosCitados, segundaDaSemana,
} from './feedback-qualidade';

let seq = 0;
const ap = (feedback: string, extra: Partial<ApontamentoFeedback> = {}): ApontamentoFeedback => ({
  id: String(++seq), numeroOs: '047552', data: '2026-11-10', executante: '707001', area: 'MECA',
  status: 'EXEC', horas: 2, feedback, descricaoOs: 'TROCA DE ROLOS NA RAMPA DA TC07', ...extra,
});
const motivos = (f: string, extra: Partial<ApontamentoFeedback> = {}, os?: Set<string>) =>
  avaliarFeedbacks([ap(f, extra)], os)[0].motivos;

describe('feedback-qualidade', () => {
  it('genérico', () => {
    for (const f of ['ok', 'OK.', '.', 'Ordem executada.', 'ATIVIDADE REALIZADA', 'atividade em andamento....',
      'Realizado preventiva conforme plano de manutenção', 'Serviço executado', 'executada atividade']) {
      expect(motivos(f)).toContain('generico');
    }
  });

  it('curto mas não genérico', () => {
    expect(motivos('Trocado fusível')).toEqual(['curto']);
  });

  it('feedback bom passa', () => {
    const f = 'Substituídos 12 rolos de carga da rampa da TC07, alinhada a correia e testada com operação. Sem pendências.';
    expect(motivos(f)).toEqual([]);
  });

  it('pendência sem nº de OS', () => {
    expect(motivos('Realizada limpeza e reaperto. Há células para substituir, será aberta ordem para troca.')).toContain('pendencia_sem_os');
    expect(motivos('Atividade realizada. Anomalias já relatadas e ordens abertas sobre as anomalias')).toContain('pendencia_sem_os');
  });

  it('pendência com nº de OS passa', () => {
    expect(motivos('Realizada limpeza e reaperto. Células a substituir, aberta OS 048123 para troca.')).toEqual([]);
    expect(motivos('Inspeção ok, anomalia no mancal tratada na OS 48123', {}, new Set(['048123']))).toEqual([]);
  });

  it('OS citada que não existe no SIGMA', () => {
    expect(motivos('Encontrada anomalia, aberta OS 999999 para correção.', {}, new Set(['048123']))).toEqual(['os_citada_inexistente']);
  });

  it('negação de pendência não acusa', () => {
    expect(mencionaPendencia(normalizarTexto('Inspeção realizada nos motores, sem pendências'))).toBe(false);
    expect(mencionaPendencia(normalizarTexto('não foram encontradas anomalias'))).toBe(false);
    expect(mencionaPendencia(normalizarTexto('PENDÊNCIA NR-10 instalada barreira física'))).toBe(false);
  });

  it('número da própria OS não conta como OS da pendência', () => {
    expect(motivos('Pendência: falta pintura, ver OS 047552', { numeroOs: '047552' })).toContain('pendencia_sem_os');
  });

  it('números citados', () => {
    expect(numerosCitados('os 48123 e 039684, corrente 05 a 06 a, 1.234,56')).toEqual(['048123', '039684']);
  });

  it('cópia da descrição da OS', () => {
    expect(motivos('TROCA DE ROLOS NA RAMPA DA TC07')).toContain('copia_descricao');
  });

  it('pouco detalhe pra muitas horas', () => {
    expect(motivos('Troca de rolos na TC07 feita', { horas: 8, descricaoOs: '' })).toEqual(['pouco_detalhe']);
    expect(motivos('Troca de rolos na TC07 feita', { horas: 2, descricaoOs: '' })).toEqual([]);
  });

  it('mesmo texto em 3 OS diferentes do mesmo executante', () => {
    const t = 'Realizada atividade, aguardando relatório para devido tratamento.';
    const r = avaliarFeedbacks([ap(t, { numeroOs: '1' }), ap(t, { numeroOs: '2' }), ap(t, { numeroOs: '3' }), ap(t, { numeroOs: '4', executante: 'x' })]);
    expect(r.slice(0, 3).every(a => a.motivos.includes('repetido'))).toBe(true);
    expect(r[3].motivos).not.toContain('repetido');
  });

  it('EXEC com texto de não concluído', () => {
    expect(motivos('Iniciada a troca da emergência, não foi concluído por falta de peça compatível', { status: 'EXEC' })).toContain('status_incoerente');
    expect(motivos('Iniciada a troca da emergência, não foi concluído por falta de peça compatível', { status: 'EXPA' })).not.toContain('status_incoerente');
  });

  it('agrupa e conta', () => {
    const r = avaliarFeedbacks([ap('ok'), ap('ok', { executante: 'b' }), ap('Substituídos 12 rolos de carga e testado com operação, sem pendências', { executante: 'b' })]);
    const g = agruparPor(r, a => a.executante);
    expect(g[0]).toMatchObject({ chave: '707001', total: 1, ruins: 1, pct: 100 });
    expect(g[1]).toMatchObject({ chave: 'b', total: 2, ruins: 1, pct: 50 });
    expect(contarMotivos(r)).toEqual([{ motivo: 'generico', count: 2 }]);
  });

  it('segunda da semana', () => {
    expect(segundaDaSemana('2026-11-13')).toBe('2026-11-09');
    expect(segundaDaSemana('2026-11-09')).toBe('2026-11-09');
    expect(segundaDaSemana('2026-11-15')).toBe('2026-11-09');
  });

  describe('padrão ATIVIDADE/ENCONTRADO/MATERIAL/PENDÊNCIA/SITUAÇÃO (desde 13/11/2026)', () => {
    const bom = [
      'ATIVIDADE: Substituídos 12 rolos de carga da rampa da TC07 e alinhada a correia.',
      'ENCONTRADO: Rolos travados e com rolamento danificado. Correia desalinhada lado motor.',
      'MATERIAL: 12 rolos de carga.',
      'PENDÊNCIA: Raspador primário desgastado, aberta OS 048123.',
      'SITUAÇÃO: Testado com a operação, equipamento liberado.',
    ].join('\n');
    const semPend = bom.replace('PENDÊNCIA: Raspador primário desgastado, aberta OS 048123.', 'PENDÊNCIA: Nenhuma.');

    it('extrai os campos', () => {
      const c = extrairCamposPadrao(normalizarTexto(bom));
      expect(Object.keys(c)).toEqual(['atividade', 'encontrado', 'material', 'pendencia', 'situacao']);
      expect(c.material).toBe('12 rolos de carga');
      expect(c.pendencia).toBe('raspador primario desgastado, aberta os 048123');
    });

    it('modelo completo passa (com OS na pendência ou "Nenhuma")', () => {
      expect(motivos(bom, { data: '2026-11-13' }, new Set(['048123']))).toEqual([]);
      expect(motivos(semPend, { data: '2026-11-14' })).toEqual([]);
      expect(motivos(semPend.replace('Nenhuma.', 'Não há'), { data: '2026-11-14' })).toEqual([]);
      expect(motivos(semPend.replace('MATERIAL: 12 rolos de carga.', 'MATERIAL: Nenhum'), { data: '2026-11-14' })).toEqual([]);
    });

    it('no padrão, anomalia no ENCONTRADO não exige OS se PENDÊNCIA diz nenhuma', () => {
      expect(motivos(semPend.replace('Rolos travados', 'Anomalia: rolos travados'), { data: '2026-11-14' })).toEqual([]);
    });

    it('pendência descrita sem OS', () => {
      expect(motivos(bom.replace(', aberta OS 048123', ''), { data: '2026-11-14' })).toEqual(['pendencia_sem_os']);
    });

    it('campo faltando ou vazio = fora do padrão, com quais faltam', () => {
      const r = avaliarFeedbacks([ap(bom.replace('MATERIAL: 12 rolos de carga.', 'MATERIAL:').replace(/SITUAÇÃO:.*$/, ''), { data: '2026-11-14' })], new Set(['048123']))[0];
      expect(r.motivos).toEqual(['fora_padrao']);
      expect(r.camposFaltando).toEqual(['material', 'situacao']);
    });

    it('texto livre a partir de 13/11 = fora do padrão; antes não', () => {
      const livre = 'Substituídos 12 rolos de carga da rampa da TC07, alinhada a correia e testada com operação. Sem pendências.';
      expect(motivos(livre, { data: '2026-11-13' })).toEqual(['fora_padrao']);
      expect(motivos(livre, { data: '2026-11-12' })).toEqual([]);
    });

    it('ATIVIDADE genérica no padrão = genérico', () => {
      expect(motivos(semPend.replace(/ATIVIDADE:.*\n/, 'ATIVIDADE: ok\n'), { data: '2026-11-14' })).toContain('generico');
    });
  });
});
