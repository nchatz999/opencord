import type { Component } from "solid-js";
import {
    createSignal,
    createMemo,
    createEffect,
    For,
    Show,
    on,
} from "solid-js";
import { useChannel, useMessage, useUser, useContext } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import MessageComponent from "./Message";

const MESSAGES_LIMIT = 50;
const SCROLL_THRESHOLD = 5;

const toContextId = (c: { type: string; id: number }) => `${c.type}-${c.id}`;

const waitForRender = (): Promise<void> =>
    new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

const isAtTop = (el: HTMLElement) =>
    Math.abs(el.scrollTop) >= el.scrollHeight - el.clientHeight - SCROLL_THRESHOLD;

const ChatContent: Component = () => {
    const [, channelActions] = useChannel();
    const [, messageActions] = useMessage();
    const [, userActions] = useUser();
    const [contextState, contextActions] = useContext();
    const { addToast } = useToaster();

    let containerRef: HTMLDivElement | undefined;

    const [isLoadingMore, setIsLoadingMore] = createSignal(false);
    const [stableContextId, setStableContextId] = createSignal<string | null>(null);

    const ctx = createMemo(() => contextState.context);

    const messages = createMemo(() => {
        const context = ctx();
        if (!context) return [];
        return context.type === "dm"
            ? messageActions.findByRecipient(context.id)
            : messageActions.findByChannel(context.id);
    });

    const contextKey = createMemo(() => {
        const c = ctx();
        return c ? { type: c.type, id: c.id } : null;
    });

    const loadMoreMessages = async () => {
        const context = ctx();
        if (!context || isLoadingMore() || !containerRef) return;

        setIsLoadingMore(true);

        const msgs = messages();
        const cursor = msgs[0]?.createdAt ?? new Date().toISOString();

        const result = await messageActions.fetchMessages(
            context.type,
            context.id,
            MESSAGES_LIMIT,
            cursor
        );

        if (result.isErr()) {
            addToast(`Error: ${result.error}`, "error");
        }

        setIsLoadingMore(false);
    };

    const handleScroll = () => {
        const context = ctx();
        if (!context || !containerRef) return;

        if (stableContextId() === toContextId(context)) {
            contextActions.setScrollPosition(context, containerRef.scrollTop);
        }

        if (isAtTop(containerRef)) {
            loadMoreMessages();
        }
    };

    createEffect(on(contextKey, async (context) => {
        if (!context) return;

        setStableContextId(null);

        if (messages().length === 0) {
            await loadMoreMessages();
        }

        await waitForRender();
        if (!containerRef) return;

        if (contextActions.hasVisited(context)) {
            const saved = contextActions.getScrollPosition(context);
            if (saved !== undefined) containerRef.scrollTop = saved;
        } else {
            containerRef.scrollTop = 0;
            contextActions.markVisited(context);
        }

        setStableContextId(toContextId(context));
    }, { defer: true }));

    const messageType = createMemo(
        () => ctx()?.type === "dm" ? "direct" as const : "channel" as const
    );

    const emptyInfo = createMemo(() => {
        const context = ctx();
        if (!context || messages().length > 0) return null;

        if (context.type === "dm") {
            const user = userActions.findById(context.id);
            if (!user) return null;
            return { title: user.username, subtitle: `This is the beginning of your conversation with ${user.username}` };
        }

        if (context.type === "channel") {
            const channel = channelActions.findById(context.id);
            if (!channel) return null;
            return { title: channel.channelName, subtitle: `Be the first to send a message in #${channel.channelName}` };
        }

        return null;
    });

    return (
        <div
            ref={containerRef}
            class="flex-1 flex flex-col-reverse overflow-auto px-4 py-2 min-h-0"
            onScroll={handleScroll}
        >
            <Show when={emptyInfo()}>
                {(info) => (
                    <div class="flex-1 flex items-center justify-center text-fg-muted">
                        <div class="text-center">
                            <h3 class="text-lg font-medium mb-1">{info().title}</h3>
                            <p class="text-sm">{info().subtitle}</p>
                        </div>
                    </div>
                )}
            </Show>
            <Show when={messages().length > 0}>
                <div class="flex flex-col gap-2">
                    <For each={messages()}>
                        {(message) => <MessageComponent message={message} type={messageType()} />}
                    </For>
                </div>
            </Show>
        </div>
    );
};

export default ChatContent;
