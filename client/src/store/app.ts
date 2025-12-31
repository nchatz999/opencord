import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

export type AppView = "loading" | "unauthenticated" | "app" | "error" | "unsupported";

export interface AppState {
  view: AppView;
  error: string | null;
}

export interface AppActions {
  setView: (view: AppView, error?: string) => void;
}

export type AppStore = [AppState, AppActions];

function createAppStore(): AppStore {
  const [state, setState] = createStore<AppState>({
    view: "loading",
    error: null,
  });

  const actions: AppActions = {
    setView(view, error) {
      setState({ view, error: error ?? null });
    },
  };

  return [state, actions];
}

let instance: AppStore | null = null;

export function useApp(): AppStore {
  if (!instance) {
    createRoot(() => {
      instance = createAppStore();
    });
  }
  return instance!;
}
