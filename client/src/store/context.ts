import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

type ContextType = "channel" | "dm";
type ContextKey = `${ContextType}-${number}`;

interface MessageContext {
  type: ContextType;
  id: number;
}

interface ContextState {
  context: MessageContext | null;
  unread: ContextKey[];
  replyingToMessageId: number | null;
}

interface ContextActions {
  get: () => MessageContext | null;
  set: (ctx: MessageContext | null) => void;
  clear: () => void;
  isCurrentContext: (type: ContextType, id: number) => boolean;

  markUnread: (type: ContextType, id: number) => void;
  markRead: (type: ContextType, id: number) => void;
  hasUnread: (type: ContextType, id: number) => boolean;
  hasAnyUnread: (type: ContextType) => boolean;
  clearAllUnread: () => void;

  getScrollPosition: (ctx: MessageContext) => number | undefined;
  setScrollPosition: (ctx: MessageContext, position: number) => void;

  hasVisited: (ctx: MessageContext) => boolean;
  markVisited: (ctx: MessageContext) => void;
  deleteVisited: (ctx: MessageContext) => void;

  setReplyingTo: (messageId: number | null) => void;
  getReplyingTo: () => number | null;

  cleanup: () => void;
}

export type ContextStore = [ContextState, ContextActions];

function toKey(type: ContextType, id: number): ContextKey {
  return `${type}-${id}`;
}

function createContextStore(): ContextStore {
  const [state, setState] = createStore<ContextState>({
    context: null,
    unread: [],
    replyingToMessageId: null,
  });

  const scrollPositions = new Map<ContextKey, number>();
  const visitedContexts = new Set<ContextKey>();

  const actions: ContextActions = {
    get() {
      return state.context;
    },

    set(ctx) {
      setState("context", ctx);
      if (ctx)
        this.markRead(ctx.type, ctx.id);
    },

    clear() {
      setState("context", null);
    },

    isCurrentContext(type, id) {
      return state.context?.type === type && state.context?.id === id;
    },

    markUnread(type, id) {
      const key = toKey(type, id);
      if (!state.unread.includes(key)) {
        setState("unread", [...state.unread, key]);
      }
    },

    markRead(type, id) {
      const key = toKey(type, id);
      setState("unread", state.unread.filter((k) => k !== key));
    },

    hasUnread(type, id) {
      return state.unread.includes(toKey(type, id));
    },

    hasAnyUnread(type) {
      return state.unread.some((key) => key.startsWith(`${type}-`));
    },

    clearAllUnread() {
      setState("unread", []);
    },

    getScrollPosition(ctx) {
      return scrollPositions.get(toKey(ctx.type, ctx.id));
    },

    setScrollPosition(ctx, position) {
      scrollPositions.set(toKey(ctx.type, ctx.id), position);
    },

    hasVisited(ctx) {
      return visitedContexts.has(toKey(ctx.type, ctx.id));
    },

    markVisited(ctx) {
      visitedContexts.add(toKey(ctx.type, ctx.id));
    },

    deleteVisited(ctx) {
      visitedContexts.delete(toKey(ctx.type, ctx.id));
      if (this.isCurrentContext(ctx.type, ctx.id)) {
        setState("context", null);
      }
    },

    setReplyingTo(messageId) {
      setState("replyingToMessageId", messageId);
    },

    getReplyingTo() {
      return state.replyingToMessageId;
    },

    cleanup() {
      setState("context", null);
      setState("unread", []);
      setState("replyingToMessageId", null);
      scrollPositions.clear();
      visitedContexts.clear();
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
