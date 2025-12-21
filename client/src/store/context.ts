import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

interface MessageContext {
  type: "channel" | "dm";
  id: number;
}

interface ContextState {
  context: MessageContext | null;
}

type ContextKey = `${"channel" | "dm"}-${number}`;

interface ContextActions {
  get: () => MessageContext | null;
  set: (ctx: MessageContext) => void;
  clear: () => void;
  getScrollPosition: (ctx: MessageContext) => number | undefined;
  setScrollPosition: (ctx: MessageContext, position: number) => void;
  hasVisited: (ctx: MessageContext) => boolean;
  markVisited: (ctx: MessageContext) => void;
}

export type ContextStore = [ContextState, ContextActions];

function createContextStore(): ContextStore {
  const [state, setState] = createStore<ContextState>({
    context: null,
  });

  const scrollPositions = new Map<ContextKey, number>();
  const visitedContexts = new Set<ContextKey>();

  const getContextKey = (ctx: MessageContext): ContextKey =>
    `${ctx.type}-${ctx.id}`;

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

    getScrollPosition(ctx) {
      return scrollPositions.get(getContextKey(ctx));
    },

    setScrollPosition(ctx, position) {
      scrollPositions.set(getContextKey(ctx), position);
    },

    hasVisited(ctx) {
      return visitedContexts.has(getContextKey(ctx));
    },

    markVisited(ctx) {
      visitedContexts.add(getContextKey(ctx));
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
