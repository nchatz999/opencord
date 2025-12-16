import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { setServerUrl } from "../lib/ServerConfig";
import type { User, Session } from "../model";
import { useUser } from "./user";
import { useConnection } from "./connection";
import { useApp } from "./app";

interface AuthSession {
  userId: number;
  sessionToken: string;
}

const saveSession = (token: string, id: number) => {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `session_token=${token}; path=/; SameSite=Strict${secure}`;
  document.cookie = `user_id=${id}; path=/; SameSite=Strict${secure}`;
};

const loadSession = (): Result<AuthSession, Error> => {
  let userId: number | undefined;
  let sessionToken: string | undefined;
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "session_token") sessionToken = value;
    if (name === "user_id") userId = parseInt(value);
  }
  if (userId && sessionToken) return ok({ sessionToken, userId });
  return err(new Error("No session"));
};

const clearSession = () => {
  document.cookie = `session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  document.cookie = `user_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

export interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
}

export interface AuthActions {
  getUser: () => User;
  getSession: () => AuthSession;
  login: (username: string, password: string, serverUrl?: string) => Promise<Result<void, string>>;
  register: (username: string, password: string, inviteCode: string, serverUrl?: string) => Promise<Result<void, string>>;
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

    async login(username, password, serverUrl) {
      setState("isLoading", true);

      if (serverUrl) {
        setServerUrl(serverUrl);
      }

      const result = await fetchApi<{
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

    async register(username, password, inviteCode, serverUrl) {
      setState("isLoading", true);

      if (serverUrl) {
        setServerUrl(serverUrl);
      }

      const result = await fetchApi<{ user_id: number }>("/auth/register", {
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
        setState("session", null);
        return ok(undefined);
      }

      const result = await fetchApi("/auth/logout", {
        method: "POST",
        body: { session_token: state.session.sessionToken },
      });

      clearSession();
      setState("session", null);

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async getSessions() {
      const result = await fetchApi<Session[]>("/auth/sessions", {
        method: "GET",
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value);
    },

    async terminateSession(sessionToken) {
      const result = await fetchApi("/auth/logout", {
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
    setState("session", null);
    appActions.setView("unauthenticated");
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
