import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { supabaseConfig } from '../supabase.config';
import { NotificationService } from './notification.service';
import type { RestError } from '../models/database.types';

export interface RestResult<T> {
  data: T | null;
  error: RestError | null;
  status?: number;
}

export interface PagedRestResult<T> {
  data: T[];
  total: number;
  error: RestError | null;
  status?: number;
}

@Injectable({ providedIn: 'root' })
export class SupabaseRestService {
  private readonly DEFAULT_TIMEOUT_MS = 15000;
  private handlingAuthFailure = false;

  constructor(
    private authService: AuthService,
    private notificationService: NotificationService,
    private router: Router
  ) {}

  async get<T>(path: string, timeoutMs = this.DEFAULT_TIMEOUT_MS): Promise<RestResult<T>> {
    return this.request<T>('GET', path, undefined, timeoutMs);
  }

  async getPaged<T>(path: string, timeoutMs = this.DEFAULT_TIMEOUT_MS): Promise<PagedRestResult<T>> {
    const token = await this.authService.getValidAccessToken();
    if (!token) {
      await this.handleAuthRequired();
      return { data: [], total: 0, error: { message: 'Sessão expirada.', code: 'AUTH_REQUIRED', status: 401 }, status: 401 };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
        method: 'GET',
        headers: { ...this.buildHeaders(token), Prefer: 'count=exact' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        let parsedBody: Record<string, unknown> = {};
        try { parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}; } catch { parsedBody = { message: rawBody }; }
        const error: RestError = typeof parsedBody['message'] === 'string'
          ? { ...(parsedBody as Partial<RestError>), message: parsedBody['message'], status: response.status }
          : { message: response.statusText || 'Erro HTTP', status: response.status };

        if ((response.status === 401 || response.status === 403)) {
          const refresh = await this.authService.refreshSessionBeforeOperation();
          if (refresh.success) return this.getPaged<T>(path, timeoutMs);
          await this.handleAuthRequired();
        }
        return { data: [], total: 0, error, status: response.status };
      }

      const contentRange = response.headers.get('Content-Range') ?? response.headers.get('content-range') ?? '';
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
      const data = (await response.json().catch(() => [])) as T[];

      return { data, total, error: null, status: response.status };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { data: [], total: 0, error: { message: 'Tempo limite excedido.', code: 'TIMEOUT', status: 408 }, status: 408 };
      }
      return { data: [], total: 0, error: { message: String(error) }, status: 0 };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post(path: string, body: unknown, timeoutMs = this.DEFAULT_TIMEOUT_MS): Promise<RestResult<null>> {
    return this.request<null>('POST', path, body, timeoutMs);
  }

  async patch(path: string, body: unknown, timeoutMs = this.DEFAULT_TIMEOUT_MS): Promise<RestResult<null>> {
    return this.request<null>('PATCH', path, body, timeoutMs);
  }

  async delete(path: string, timeoutMs = this.DEFAULT_TIMEOUT_MS): Promise<{ success: boolean; error: any; status?: number }> {
    const result = await this.request<null>('DELETE', path, undefined, timeoutMs);
    return { success: !result.error, error: result.error, status: result.status };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = this.DEFAULT_TIMEOUT_MS,
    retryOnAuthFailure = true
  ): Promise<RestResult<T>> {
    const token = await this.authService.getValidAccessToken();
    if (!token) {
      await this.handleAuthRequired();
      return {
        data: null,
        error: { message: 'Sessão expirada. Faça login novamente.', code: 'AUTH_REQUIRED', status: 401 },
        status: 401,
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${supabaseConfig.url}/rest/v1/${path}`, {
        method,
        headers: this.buildHeaders(token),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        } catch {
          parsedBody = { message: rawBody || response.statusText || 'Erro HTTP' };
        }

        const normalizedError: RestError = typeof parsedBody['message'] === 'string'
          ? { ...(parsedBody as Partial<RestError>), message: parsedBody['message'], status: response.status }
          : { message: response.statusText || 'Erro HTTP', status: response.status, details: rawBody };

        console.error('[SupabaseRestService] Request failed', {
          method,
          path,
          status: response.status,
          error: normalizedError,
        });

        if ((response.status === 401 || response.status === 403) && retryOnAuthFailure) {
          const refresh = await this.authService.refreshSessionBeforeOperation();
          if (refresh.success) {
            return this.request<T>(method, path, body, timeoutMs, false);
          }
          await this.handleAuthRequired();
          return {
            data: null,
            error: { message: 'Sessão expirada. Faça login novamente.', code: 'AUTH_REQUIRED', status: response.status },
            status: response.status,
          };
        }

        return { data: null, error: normalizedError, status: response.status };
      }

      if (method === 'GET') {
        const data = (await response.json().catch(() => null)) as T | null;
        return { data, error: null, status: response.status };
      }

      return { data: null, error: null, status: response.status };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          data: null,
          error: { message: 'Tempo limite excedido. Tente novamente.', code: 'TIMEOUT', status: 408 },
          status: 408,
        };
      }
      return { data: null, error, status: 0 };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildHeaders(token: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      apikey: supabaseConfig.key,
      Authorization: `Bearer ${token}`,
      Prefer: 'return=minimal',
    };
  }

  private async handleAuthRequired(): Promise<void> {
    if (this.handlingAuthFailure) return;
    this.handlingAuthFailure = true;

    try {
      this.notificationService.showError('Sua sessão expirou. Faça login novamente.');
      await this.authService.logout();
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch {
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } finally {
      this.handlingAuthFailure = false;
    }
  }
}
