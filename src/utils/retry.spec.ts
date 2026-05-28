import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { withRetry } from './retry';

describe('withRetry', () => {
  it('retorna resultado imediatamente quando a função tem sucesso', async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('lança erro imediatamente quando retryIf retorna false', async () => {
    const validationError = { message: 'campo inválido', code: 'VALIDATION' };
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(validationError);

    await expect(
      withRetry(fn, { maxAttempts: 3, retryIf: () => false })
    ).rejects.toEqual(validationError);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respeita maxAttempts e lança erro após esgotar tentativas', async () => {
    const networkError = { message: 'timeout' };
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(networkError);

    await expect(
      withRetry(fn, { maxAttempts: 3, delayMs: 0 })
    ).rejects.toEqual(networkError);

    expect(fn).toHaveBeenCalledTimes(3);
  }, 15000);

  describe('com fake timers', () => {
    beforeEach(async () => { jest.useFakeTimers(); });
    afterEach(async () => { jest.useRealTimers(); });

    it('retenta em erros de rede e retorna resultado na segunda tentativa', async () => {
      const networkError = { message: 'network error' };
      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('recuperou');

      const promise = withRetry(fn, { maxAttempts: 3, delayMs: 100 });
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('recuperou');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('chama onRetry com o número da tentativa e o erro', async () => {
      const networkError = { message: 'fetch failed' };
      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('ok');

      const onRetry = jest.fn<(attempt: number, error: unknown) => void>();
      const promise = withRetry(fn, { maxAttempts: 3, delayMs: 50, onRetry });
      await jest.runAllTimersAsync();
      await promise;

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, networkError);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, networkError);
    });

    it('reconhece erros de timeout pelo código PGRST301', async () => {
      const supabaseError = { message: 'query failed', code: 'PGRST301' };
      const fn = jest.fn<() => Promise<string>>()
        .mockRejectedValueOnce(supabaseError)
        .mockResolvedValueOnce('ok');

      const promise = withRetry(fn, { maxAttempts: 2, delayMs: 50 });
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
