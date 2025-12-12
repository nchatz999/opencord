import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

interface MessageContext {
  type: "channel" | "dm";
  id: number;
}

interface ContextState {
  context: MessageContext | null;
}

interface ContextActions {
  get: () => MessageContext | null;
  set: (ctx: MessageContext) => void;
  clear: () => void;
}

export type ContextStore = [ContextState, ContextActions];

function createContextStore(): ContextStore {
  const [state, setState] = createStore<ContextState>({
    context: null,
  });

  const actions: ContextActions = {
    get() {
      return state.context;
    },

    set(ctx) {
      setState("context", ctx);
    },

    clear() {
      setState("context", null);
    },
  };

  return [state, actions];
}

let instance: ContextStore | null = null;

export function useContext(): ContextStore {
  if (!instance) {
    createRoot(() => {
      instance = createContextStore();
    });
  }
  return instance!;
}
