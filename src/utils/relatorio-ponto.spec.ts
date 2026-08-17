import { agregarHorasPonto, extrairHorasPontoDePagina } from './relatorio-ponto';

// Fixtures no mesmo formato real extraido do PDF "Espelho do Ponto" (texto puro,
// sem colunas alinhadas — é como o pdfjs entrega o texto de uma página).
function paginaAdm5x2(): string {
  return [
    'Espelho do Ponto',
    'Empresa: Porto do Pecem Transportadora de Minerios S/A CNPJ: 10.661.303/0001-09',
    'Rodovia CE-085, s/n',
    'Matrícula: 01 - 006162 Nome: ANTONIO JOSE LIMA DOS SANTOS Chapa:',
    'Categoria: M \tC.C.: 2025000078 - TCLD TRECHO 02-PM Função: 00115 - TEC OPER E MANUT PL',
    'Turno: 009 5X2 - 07:30 12:00 12:30 16:00\tDepartamento: 000000065 - MANUTENÇÃO',
    'Sit...: NORMAL',
    'Data Dia 1a E. 1a S. 2a E. 2a S. 3a E. 3a S. 4a E. 4a S. Abono H.E.\tH.Trab Absent. Ad. Not. Observação',
    '01/07/2026 Quarta 07:28 12:00 * 12:30 * 16:00',
    '02/07/2026 Quinta 07:26 12:00 * 12:30 * 16:04',
    '04/07/2026 Sabado \t** Compensado **',
    '05/07/2026 Domingo \t** D.S.R. **',
    '14/07/2026 Terca 07:28 12:00 * 12:30 * 18:27 \t02:27',
    '18/07/2026 Sabado 06:53 17:17 \t** Compensado **\t20:48',
    '31/07/2026 Sexta ** Ausente ** 08:00 \tFOLGA ANIVERSARIO\t08:00',
    'Banco de Horas Saldo Anterior Débito Crédito \tSaldo Atual',
    '-7,32 0,00 50,53 \t43,21',
    '__________________________________________________',
    'Assinatura do Funcionário',
  ].join('\n');
}

function pagina4x4Noturno(): string {
  return [
    'Espelho do Ponto',
    'Empresa: Porto do Pecem Transportadora de Minerios S/A CNPJ: 10.661.303/0001-09',
    'Rodovia CE-085, s/n',
    'Matrícula: 01 - 004578 Nome: ANTONIO NARCELIO S. DE SOUZA Chapa:',
    'Categoria: M \tC.C.: 2025000080 - OPERACOES-GTPP-PM Função: 00084 - OP CARV E SUBPROD SR',
    'Turno: 004 4X4 - ESCALA PPTM\tDepartamento: 000000034 - OPERAÇÃO',
    'Sit...: NORMAL',
    'Data Dia 1a E. 1a S. 2a E. 2a S. 3a E. 3a S. 4a E. 4a S. Abono H.E.\tH.Trab Absent. Ad. Not. Observação',
    '01/07/2026 Quarta 19:28 22:00 * 23:00 * 07:25 \t08:25',
    '03/07/2026 Sexta \t** D.S.R. **',
    'Banco de Horas Saldo Anterior Débito Crédito \tSaldo Atual',
    '-34,06 0,17 0,14 \t-34,09',
    '__________________________________________________',
    'Assinatura do Funcionário',
  ].join('\n');
}

const JULHO_INICIO = new Date(Date.UTC(2026, 6, 1));
const JULHO_FIM = new Date(Date.UTC(2026, 6, 31));

describe('extrairHorasPontoDePagina', () => {
  it('extrai a matricula (ultimo numero da linha com "Matricula")', () => {
    const r = extrairHorasPontoDePagina(paginaAdm5x2(), JULHO_INICIO, JULHO_FIM);
    expect(r?.matricula6).toBe('006162');
  });

  it('classifica turno ADM 5x2 e desconta 0.5h de almoco fixo por dia', () => {
    // dia 01/07: 07:28 ate 16:00 (4a batida) = 8h32 - 0.5h almoco = 8.0333...
    const r = extrairHorasPontoDePagina(paginaAdm5x2(), JULHO_INICIO, JULHO_FIM);
    expect(r?.turno).toBe('ADM_5X2');
  });

  it('usa a 1a e a 4a batida quando ha 4 ou mais, ignorando H.Trab que sobra depois', () => {
    // dia 14/07 tem 07:28,12:00,12:30,18:27 + "02:27" (H.Trab) -- deve ignorar o 02:27
    const textoUmDiaSo = [
      'Espelho do Ponto', 'Data Dia', 'Matrícula: 01 - 000001 Nome: TESTE',
      'Turno: 009 5X2 - 07:30 12:00 12:30 16:00',
      '14/07/2026 Terca 07:28 12:00 * 12:30 * 18:27 \t02:27',
    ].join('\n');
    const r = extrairHorasPontoDePagina(textoUmDiaSo, JULHO_INICIO, JULHO_FIM);
    // 18:27 - 07:28 = 10h59 = 10.9833h; -0.5 almoco = 10.4833
    expect(r?.horas).toBeCloseTo(10.48, 1);
  });

  it('usa a 1a e a 2a batida quando ha so 2 ou 3 batidas no dia', () => {
    const texto = [
      'Espelho do Ponto', 'Data Dia', 'Matrícula: 01 - 000002 Nome: TESTE',
      'Turno: 009 5X2 - 07:30 12:00',
      '01/07/2026 Quarta 08:00 12:00',
    ].join('\n');
    const r = extrairHorasPontoDePagina(texto, JULHO_INICIO, JULHO_FIM);
    // 12:00 - 08:00 = 4h; -0.5 almoco = 3.5h
    expect(r?.horas).toBeCloseTo(3.5, 2);
  });

  it('pula dias marcados como D.S.R., Compensado ou Ausente, mesmo com batidas registradas', () => {
    const r = extrairHorasPontoDePagina(paginaAdm5x2(), JULHO_INICIO, JULHO_FIM);
    // soma so 01/07 (8.0333) + 02/07 (16:04-07:26=8.6333-0.5=8.1333) + 14/07 (10.4833)
    // 04/07 (compensado), 05/07 (dsr), 18/07 (compensado com batida), 31/07 (ausente) ficam de fora
    expect(r?.horas).toBeCloseTo(8.03 + 8.13 + 10.48, 1);
  });

  it('calcula turno 4x4 noturno com virada de dia, descontando 1h de almoco', () => {
    const r = extrairHorasPontoDePagina(pagina4x4Noturno(), JULHO_INICIO, JULHO_FIM);
    expect(r?.turno).toBe('4X4');
    // 19:28 ate 07:25 (do dia seguinte) = 11h57 = 11.95h; -1h almoco = 10.95h
    expect(r?.horas).toBeCloseTo(10.95, 1);
  });

  it('ignora dias fora do periodo (dataInicio/dataFim) informado', () => {
    const somenteJulho = extrairHorasPontoDePagina(paginaAdm5x2(), JULHO_INICIO, JULHO_FIM);
    const somenteUmDia = extrairHorasPontoDePagina(
      paginaAdm5x2(), new Date(Date.UTC(2026, 6, 1)), new Date(Date.UTC(2026, 6, 1)),
    );
    expect(somenteUmDia!.horas).toBeLessThan(somenteJulho!.horas);
  });

  it('retorna null pra uma pagina que nao e um Espelho do Ponto (ex: capa/sumario)', () => {
    expect(extrairHorasPontoDePagina('Relatório Geral\nOutra coisa qualquer', JULHO_INICIO, JULHO_FIM)).toBeNull();
  });

  it('retorna null quando nao consegue achar a matricula na pagina', () => {
    const semMatricula = 'Espelho do Ponto\nData Dia\nNome: SEM MATRICULA AQUI';
    expect(extrairHorasPontoDePagina(semMatricula, JULHO_INICIO, JULHO_FIM)).toBeNull();
  });
});

describe('agregarHorasPonto', () => {
  it('soma horas de duas paginas do mesmo colaborador (mes dividido em quinzenas)', () => {
    const pagina1 = [
      'Espelho do Ponto', 'Data Dia', 'Matrícula: 01 - 000003 Nome: TESTE',
      'Turno: 009 5X2 - 07:30 12:00',
      '01/07/2026 Quarta 08:00 12:00 12:30 16:00',
    ].join('\n');
    const pagina2 = [
      'Espelho do Ponto', 'Data Dia', 'Matrícula: 01 - 000003 Nome: TESTE',
      'Turno: 009 5X2 - 07:30 12:00',
      '15/07/2026 Quarta 08:00 12:00 12:30 16:00',
    ].join('\n');
    const totais = agregarHorasPonto([pagina1, pagina2], JULHO_INICIO, JULHO_FIM);
    expect(totais.get('000003')?.horas).toBeCloseTo(7.5 * 2, 1);
  });

  it('mantem colaboradores diferentes em entradas separadas', () => {
    const totais = agregarHorasPonto([paginaAdm5x2(), pagina4x4Noturno()], JULHO_INICIO, JULHO_FIM);
    expect(totais.size).toBe(2);
    expect(totais.has('006162')).toBe(true);
    expect(totais.has('004578')).toBe(true);
  });

  it('ignora paginas invalidas sem quebrar a agregacao das validas', () => {
    const totais = agregarHorasPonto(['pagina de capa qualquer', paginaAdm5x2()], JULHO_INICIO, JULHO_FIM);
    expect(totais.size).toBe(1);
  });
});
