import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Result } from 'opencord-utils'
import { err, ok } from 'opencord-utils'
import { getHttpUrl } from './lib/ServerConfig'
import { UserStatusType } from './model'

export async function safelyCancelReader<T>(
  reader: ReadableStreamDefaultReader<T> | null
): Promise<void> {
  if (!reader) return;
  try {
    await reader.cancel();
  } catch { }
}

export function closeEncoder(encoder: VideoEncoder | AudioEncoder | null): void {
  if (encoder && encoder.state !== "closed") {
    encoder.close();
  }
}

export function stopStreamTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function convertToMono(value: AudioData): AudioData {
  const buffer = new ArrayBuffer(value.numberOfFrames * 4);
  value.copyTo(buffer, { planeIndex: 0 });

  return new AudioData({
    format: value.format,
    sampleRate: value.sampleRate,
    numberOfFrames: value.numberOfFrames,
    numberOfChannels: 1,
    timestamp: value.timestamp,
    data: buffer,
  });
}

export function createMonoConverter(): (value: AudioData) => AudioData {
  let buffer: ArrayBuffer | null = null;

  return (value: AudioData): AudioData => {
    const requiredSize = value.numberOfFrames * 4;
    if (!buffer || buffer.byteLength != requiredSize) {
      buffer = new ArrayBuffer(requiredSize);
    }

    value.copyTo(buffer, { planeIndex: 0 });

    return new AudioData({
      format: value.format,
      sampleRate: value.sampleRate,
      numberOfFrames: value.numberOfFrames,
      numberOfChannels: 1,
      timestamp: value.timestamp,
      data: buffer,
    });
  };
}

export function getStatusColor(status: UserStatusType, type: "bg" | "text" = "text") {
  const colors = {
    [UserStatusType.Online]: "presence-online",
    [UserStatusType.Away]: "presence-away",
    [UserStatusType.DoNotDisturb]: "presence-dnd",
    [UserStatusType.Offline]: "presence-offline",
  };
  return `${type}-${colors[status] ?? "presence-offline"}`;
}
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type ErrorResponse = {
  code: string;
  reason: string;
};

const getBaseUrl = () => {
  return getHttpUrl();
};

const SESSION_KEY = "opencord_session";

export function getSessionToken(): string | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored).sessionToken || null;
  } catch {
    return null;
  }
}

export function upload<T = unknown>(
  url: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Result<T, ErrorResponse>> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(err({ code: 'ABORTED', reason: 'Upload cancelled' }));
      return;
    }

    const xhr = new XMLHttpRequest();
    signal?.addEventListener('abort', () => xhr.abort());

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(ok(undefined as T));
      } else {
        resolve(err(JSON.parse(xhr.responseText)));
      }
    };

    xhr.onerror = () => resolve(err({ code: 'NETWORK_ERROR', reason: 'Upload failed' }));
    xhr.onabort = () => resolve(err({ code: 'ABORTED', reason: 'Upload cancelled' }));

    xhr.open('POST', `${getBaseUrl()}${url}`);
    const token = getSessionToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}

export async function request<T = unknown>(
  url: string,
  options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined | null>;
    responseType?: 'json' | 'blob';
  }
): Promise<Result<T, ErrorResponse>> {
  const { method = 'GET', body, query, responseType = 'json' } = options || {};

  let finalUrl = `${getBaseUrl()}${url}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null) params.append(key, String(value));
    }
    const queryString = params.toString();
    if (queryString) finalUrl += `?${queryString}`;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getSessionToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(finalUrl, {
      method,
      headers,
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      return err(await response.json());
    }
    if (response.headers.get('content-length') === '0') {
      return ok(undefined as T);
    }
    return ok(responseType === 'blob' ? await response.blob() : await response.json());
  } catch (error) {
    return err({
      code: 'NETWORK_ERROR',
      reason: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

