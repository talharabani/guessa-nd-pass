import type { AuthUser } from './types';

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'number-rush.token';
const LAST_USER_KEY = 'number-rush.lastUsername';

/**
 * The last username that signed in on this device. Convenience only — it is a
 * display hint for the login form and is never sent anywhere or trusted.
 */
export const lastUsername = {
  get(): string {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(LAST_USER_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set(username: string): void {
    try {
      window.localStorage.setItem(LAST_USER_KEY, username);
    } catch {
      /* ignore */
    }
  }
};

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode — the session simply won't survive a reload */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }
};

export class ApiError extends Error {
  constructor(
    message: string,
    /** e.g. USERNAME_TAKEN, BAD_CREDENTIALS — lets the UI offer the right way out. */
    readonly code?: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
    });
  } catch {
    throw new ApiError('Cannot reach the game server. Is it running?');
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError((body.error as string) ?? 'Something went wrong.', body.code as string | undefined);
  }
  return body as T;
}

interface AuthResponse {
  user: AuthUser;
  token: string;
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  login: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    }),

  me: (token: string) =>
    request<{ user: AuthUser }>('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
};
