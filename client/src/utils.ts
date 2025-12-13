import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Result } from 'opencord-utils'
import { err, ok } from 'opencord-utils'
import { getServerUrlOrDefault } from './lib/ServerConfig'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.substring(result.indexOf(',') + 1))
    }
    reader.onerror = (error) => reject(error)
  })

type ErrorResponse = {
  code: string;
  reason: string;
};

const getBaseUrl = () => {
  return getServerUrlOrDefault();
};

export async function fetchApi<T = unknown>(
  url: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined | null>;
    headers?: Record<string, string>;
  }
): Promise<Result<T, ErrorResponse>> {
  const { method = 'GET', body, query, headers = {} } = options || {};
  const baseUrl = getBaseUrl();
  let finalUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    const queryString = params.toString();
    if (queryString) {
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + queryString;
    }
  }
  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };
  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(finalUrl, fetchOptions);
    if (!response.ok) {
      const errorData = await response.json();
      return err(errorData);
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return ok(undefined as T);
    }
    const data = await response.json();
    return ok(data);
  } catch (error) {
    return err({
      code: 'NETWORK_ERROR',
      reason: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

