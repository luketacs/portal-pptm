import { fetchAllRows } from './supabase-pagination';

describe('fetchAllRows', () => {
  it('não perde páginas quando o servidor impõe um limite menor', async () => {
    const source = [1, 2, 3, 4, 5];
    const offsets: number[] = [];
    const result = await fetchAllRows(async from => {
      offsets.push(from);
      return { data: source.slice(from, from + 2), error: null };
    });
    expect(result).toEqual({ data: source, error: null });
    expect(offsets).toEqual([0, 2, 4, 5]);
  });

  it('não apresenta uma lista parcial como completa após falha', async () => {
    const result = await fetchAllRows(async from => from === 0
      ? { data: [1], error: null }
      : { data: null, error: { message: 'indisponível' } });
    expect(result).toEqual({ data: [], error: { message: 'indisponível' } });
  });
});
