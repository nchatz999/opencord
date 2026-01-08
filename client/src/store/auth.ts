import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { setDomain } from "../lib/ServerConfig";
import type { User, Session } from "../model";
import { useUser } from "./user";
import { useConnection } from "./connection";
import { useApp } from "./app";
import { clearImageCache } from "../components/Image";

interface AuthSession {
  userId: number;
  sessionToken: string;
}

const SESSION_KEY = "opencord_session";

const saveSession = (token: string, id: number) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ sessionToken: token, userId: id }));
};

const loadSession = (): Result<AuthSession, Error> => {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return err(new Error("No session"));
  try {
    const session = JSON.parse(stored) as AuthSession;
    if (session.userId && session.sessionToken) return ok(session);
    return err(new Error("Invalid session"));
  } catch {
    return err(new Error("Parse error"));
  }
};

const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
}

export interface AuthActions {
  getUser: () => User;
  getSession: () => AuthSession;
  login: (username: string, password: string, domain?: string) => Promise<Result<void, string>>;
  register: (username: string, password: string, inviteCode: string, domain?: string) => Promise<Result<void, string>>;
  logout: () => Promise<Result<void, string>>;
  getSessions: () => Promise<Result<Session[], string>>;
  terminateSession: (sessionToken: string) => Promise<Result<void, string>>;
}

export type AuthStore = [AuthState, AuthActions];

function createAuthStore(): AuthStore {
  const session = loadSession();
  const initialSession = session.isOk() ? session.value : null;
  const [, userActions] = useUser();

  const [state, setState] = createStore<AuthState>({
    session: initialSession,
    isLoading: false,
  });

  const actions: AuthActions = {
    getUser() {
      if (!state.session) throw new Error("Not authenticated");
      const user = userActions.findById(state.session.userId);
      if (!user) throw new Error("User not found");
      return user;
    },

    getSession() {
      if (!state.session) throw new Error("Not authenticated");
      return state.session;
    },

    async login(username, password, domain) {
      setState("isLoading", true);

      if (domain) {
        setDomain(domain);
      }

      const result = await request<{
        session_token: string;
        expires_at?: string;
        user_id: number;
      }>("/auth/login", {
        method: "POST",
        body: { username, password },
      });

      if (result.isErr()) {
        setState("isLoading", false);
        return err(result.error.reason || "Login failed");
      }

      saveSession(result.value.session_token, result.value.user_id);
      setState({
        session: {
          userId: result.value.user_id,
          sessionToken: result.value.session_token,
        },
        isLoading: false,
      });

      return ok(undefined);
    },

    async register(username, password, inviteCode, domain) {
      setState("isLoading", true);

      if (domain) {
        setDomain(domain);
      }

      const result = await request<{ user_id: number }>("/auth/register", {
        method: "POST",
        body: {
          username,
          password,
          invite_code: inviteCode,
        },
      });

      setState("isLoading", false);

      if (result.isErr()) {
        return err(result.error.reason || "Registration failed");
      }

      return ok(undefined);
    },

    async logout() {
      if (!state.session) {
        clearSession();
        clearImageCache();
        setState("session", null);
        return ok(undefined);
      }

      const result = await request("/auth/logout", {
        method: "POST",
        body: { session_token: state.session.sessionToken },
      });

      clearSession();
      clearImageCache();
      setState("session", null);

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async getSessions() {
      const result = await request<Session[]>("/auth/sessions", {
        method: "GET",
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value);
    },

    async terminateSession(sessionToken) {
      const result = await request("/auth/logout", {
        method: "POST",
        body: { session_token: sessionToken },
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },
  };

  const connection = useConnection();
  const [, appActions] = useApp();

  connection.onConnectionClosed(() => {
    clearSession();
    clearImageCache();
    setState("session", null);
    appActions.setView({ type: "unauthenticated" });
  });

  return [state, actions];
}

let instance: AuthStore | null = null;

export function useAuth(): AuthStore {
  if (!instance) {
    createRoot(() => {
      instance = createAuthStore();
    });
  }
  return instance!;
}
