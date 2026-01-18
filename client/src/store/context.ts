import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

type ContextType = "channel" | "dm";
type ContextKey = `${ContextType}-${number}`;

interface MessageContext {
    type: ContextType;
    id: number;
}

type MiddlePanelTab = "chat" | "streams";

interface ContextState {
    context: MessageContext | null;
    replyingToMessageId: number | null;
    activeTab: MiddlePanelTab;
}

interface ContextActions {
    get: () => MessageContext | null;
    set: (ctx: MessageContext | null) => void;
    clear: () => void;
    isCurrentContext: (type: ContextType, id: number) => boolean;

    getScrollPosition: (ctx: MessageContext) => number | undefined;
    setScrollPosition: (ctx: MessageContext, position: number) => void;

    hasVisited: (ctx: MessageContext) => boolean;
    markVisited: (ctx: MessageContext) => void;
    deleteVisited: (ctx: MessageContext) => void;

    setReplyingTo: (messageId: number | null) => void;
    getReplyingTo: () => number | null;

    setActiveTab: (tab: MiddlePanelTab) => void;
    getActiveTab: () => MiddlePanelTab;

    cleanup: () => void;
}

export type ContextStore = [ContextState, ContextActions];

function toKey(type: ContextType, id: number): ContextKey {
    return `${type}-${id}`;
}

function createContextStore(): ContextStore {
    const [state, setState] = createStore<ContextState>({
        context: null,
        replyingToMessageId: null,
        activeTab: "chat",
    });

    const scrollPositions = new Map<ContextKey, number>();
    const visitedContexts = new Set<ContextKey>();

    const actions: ContextActions = {
        get() {
            return state.context;
        },

        set(ctx) {
            setState("context", ctx);
            setState("activeTab", "chat");
        },

        clear() {
            setState("context", null);
        },

        isCurrentContext(type, id) {
            return state.context?.type === type && state.context?.id === id;
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

        setActiveTab(tab) {
            setState("activeTab", tab);
        },

        getActiveTab() {
            return state.activeTab;
        },

        cleanup() {
            setState("context", null);
            setState("replyingToMessageId", null);
            setState("activeTab", "chat");
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
