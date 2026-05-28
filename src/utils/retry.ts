export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
  retryIf?: (error: unknown) => boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1000;

function isNetworkOrTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  const message = String(e['message'] ?? '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch') ||
    e['code'] === 'PGRST301' ||
    e['status'] === 408
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    onRetry,
    retryIf = isNetworkOrTimeoutError,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLast = attempt === maxAttempts - 1;
      if (isLast || !retryIf(error)) {
        throw error;
      }

      onRetry?.(attempt + 1, error);

      const backoff = delayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}
