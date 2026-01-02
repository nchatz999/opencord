import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

export type AppView = {
  type: "loading"
  channelId?: number,
} | {
  type: "unauthenticated"
} | {
  type: "app"
} | {
  type: "error",
  error: string
} | {
  type: "unsupported"
}


export interface AppState {
  view: AppView;
}

export interface AppActions {
  setView: (view: AppView) => void;
}

export type AppStore = [AppState, AppActions];

function createAppStore(): AppStore {
  const [state, setState] = createStore<AppState>({
    view: { type: "loading" },
  });

  const actions: AppActions = {
    setView(view) {
      setState({ view });
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
