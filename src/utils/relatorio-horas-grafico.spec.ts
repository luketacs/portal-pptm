import { ColaboradorHoras } from './relatorio-apontamentos';
import { calcularGraficoHoras } from './relatorio-horas-grafico';

function colaborador(overrides: Partial<ColaboradorHoras>): ColaboradorHoras {
  return {
    matricula: '1', funcionario: 'Fulano', area: 'Mecânica',
    horasApontadas: 100, horasProgramadas: 100, horasDisponiveis: 150,
    qtdOrdens: 5, ordensLista: [],
    ...overrides,
  };
}

describe('calcularGraficoHoras', () => {
  it('usa o maior valor entre todos (apontada/programada/disponivel) como escala, com folga de 5%', () => {
    const r = calcularGraficoHoras([colaborador({ horasApontadas: 100, horasProgramadas: 80, horasDisponiveis: 200 })]);
    expect(r.escalaMaxima).toBeCloseTo(210, 1); // 200 * 1.05
  });

  it('calcula os percentuais de cada barra em relacao a escala compartilhada', () => {
    const r = calcularGraficoHoras([colaborador({ horasApontadas: 100, horasProgramadas: 80, horasDisponiveis: 200 })]);
    const b = r.barras[0];
    expect(b.percApontada).toBeCloseTo((100 / 210) * 100, 1);
    expect(b.percDisponivel).toBeCloseTo((200 / 210) * 100, 1);
    expect(b.percProgramada).toBeCloseTo((80 / 210) * 100, 1);
  });

  it('ordena por horas apontadas decrescente', () => {
    const r = calcularGraficoHoras([
      colaborador({ matricula: 'A', horasApontadas: 50 }),
      colaborador({ matricula: 'B', horasApontadas: 150 }),
      colaborador({ matricula: 'C', horasApontadas: 100 }),
    ]);
    expect(r.barras.map(b => b.matricula)).toEqual(['B', 'C', 'A']);
  });

  it('marca "estourou" quando horas apontadas excede horas disponiveis', () => {
    const r = calcularGraficoHoras([colaborador({ horasApontadas: 250, horasDisponiveis: 200 })]);
    expect(r.barras[0].estourou).toBe(true);
  });

  it('nao marca "estourou" quando nao ha dado de horas disponiveis', () => {
    const r = calcularGraficoHoras([colaborador({ horasApontadas: 250, horasDisponiveis: null })]);
    expect(r.barras[0].estourou).toBe(false);
  });

  it('percDisponivel e percProgramada ficam null quando o dado de origem e null', () => {
    const r = calcularGraficoHoras([colaborador({ horasProgramadas: null, horasDisponiveis: null })]);
    expect(r.barras[0].percDisponivel).toBeNull();
    expect(r.barras[0].percProgramada).toBeNull();
  });

  it('nao quebra com lista vazia', () => {
    const r = calcularGraficoHoras([]);
    expect(r.barras).toEqual([]);
    expect(r.escalaMaxima).toBe(1);
  });

  it('nao deixa a barra passar de 100% mesmo se o valor bater exatamente na escala maxima', () => {
    const r = calcularGraficoHoras([colaborador({ horasApontadas: 100, horasProgramadas: 100, horasDisponiveis: 100 })]);
    expect(r.barras[0].percApontada).toBeLessThanOrEqual(100);
    expect(r.barras[0].percDisponivel).toBeLessThanOrEqual(100);
  });
});
