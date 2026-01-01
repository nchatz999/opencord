import type { Component } from "solid-js";
import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  on,
  Match,
  Switch,
} from "solid-js";
import { useChannel, useMessage, useUser, useContext, useReaction } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import MessageComponent from "./MessageBubble";

const MESSAGES_LIMIT = 50;
const SCROLL_THRESHOLD = 5;

const toContextId = (c: { type: string; id: number }) => `${c.type}-${c.id}`;

const waitForImages = (container: HTMLElement, timeout = 3000): Promise<void> => {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      const images = Array.from(container.querySelectorAll("img"));
      const allReady = images.every((img) => img.src && img.complete);

      if (allReady || Date.now() - start > timeout) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };

    check();
  });
};

const waitForRender = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const ChatContent: Component = () => {
  const [, channelActions] = useChannel();
  const [, messageActions] = useMessage();
  const [, userActions] = useUser();
  const [contextState, contextActions] = useContext();
  const [, reactionActions] = useReaction();
  const { addToast } = useToaster();

  let containerRef: HTMLDivElement | undefined;

  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
  const [stableContextId, setStableContextId] = createSignal<string | null>(null);
  const [wasAtBottom, setWasAtBottom] = createSignal(true);

  const ctx = createMemo(() => contextState.context);

  const messages = createMemo(() => {
    const context = ctx();
    if (!context) return [];
    return context.type === "dm"
      ? messageActions.findByRecipient(context.id)
      : messageActions.findByChannel(context.id);
  });

  const latestMessageId = createMemo(() => {
    const msgs = messages();
    return msgs.length > 0 ? msgs[msgs.length - 1].id : null;
  });

  const lastMessageReactionCount = createMemo(() => {
    const id = latestMessageId();
    if (!id) return 0;
    return reactionActions.findByMessageId(id).length;
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
    const prevHeight = containerRef.scrollHeight;

    const result = await messageActions.fetchMessages(
      context.type,
      context.id,
      MESSAGES_LIMIT,
      cursor
    );

    if (result.isErr()) {
      addToast(`Error: ${result.error}`, "error");
      setIsLoadingMore(false);
      return;
    }

    requestAnimationFrame(() => {
      if (containerRef) {
        containerRef.scrollTop += containerRef.scrollHeight - prevHeight;
      }
    });

    setIsLoadingMore(false);
  };

  const handleScroll = () => {
    const context = ctx();
    if (!context || !containerRef) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    const maxScrollTop = scrollHeight - clientHeight;
    setWasAtBottom(Math.ceil(scrollTop) >= Math.floor(maxScrollTop));

    if (stableContextId() === toContextId(context)) {
      contextActions.setScrollPosition(context, scrollTop);
    }

    if (scrollTop < SCROLL_THRESHOLD) {
      loadMoreMessages();
    }
  };

  createEffect(on(contextKey, async (context) => {
    if (!context) return;

    const contextId = toContextId(context);
    setStableContextId(null);

    if (messages().length === 0) {
      await loadMoreMessages();
    }

    await waitForRender();
    if (containerRef) await waitForImages(containerRef);
    if (!containerRef) return;

    const savedPosition = contextActions.getScrollPosition(context);

    if (contextActions.hasVisited(context) && savedPosition !== undefined) {
      containerRef.scrollTop = savedPosition;
    } else {
      containerRef.scrollTop = containerRef.scrollHeight;
      contextActions.markVisited(context);
    }

    const targetPosition = containerRef.scrollTop;
    contextActions.setScrollPosition(context, targetPosition);

    if (containerRef) {
      containerRef.scrollTop = targetPosition;
      setStableContextId(contextId);
    }
  }, { defer: true }));


  createEffect(on([latestMessageId, lastMessageReactionCount], async () => {
    if (!stableContextId() || !containerRef || !wasAtBottom()) return;

    await waitForImages(containerRef);

    requestAnimationFrame(() => {
      if (containerRef) containerRef.scrollTop = containerRef.scrollHeight;
    });
  }, { defer: true }));

  return (
    <div
      ref={containerRef}
      class="flex-1 flex flex-col overflow-auto px-4 py-2 space-y-2 min-h-0"
      onScroll={handleScroll}
    >
      <Show when={ctx()}>
        {(context) => (
          <Switch>
            <Match when={context().type === "dm"}>
              <Show
                when={messages().length > 0}
                fallback={
                  <Show when={userActions.findById(context().id)}>
                    {(user) => (
                      <div class="flex-1 flex items-center justify-center text-muted-foreground min-h-[400px]">
                        <div class="text-center">
                          <h3 class="text-lg font-medium mb-1">
                            {user().username}
                          </h3>
                          <p class="text-sm">
                            This is the beginning of your conversation with {user().username}
                          </p>
                        </div>
                      </div>
                    )}
                  </Show>
                }
              >
                <For each={messages()}>
                  {(message) => <MessageComponent message={message} type="direct" />}
                </For>
              </Show>
            </Match>

            <Match when={context().type === "channel"}>
              <Show
                when={messages().length > 0}
                fallback={
                  <Show when={channelActions.findById(context().id)}>
                    {(channel) => (
                      <div class="flex-1 flex items-center justify-center text-muted-foreground min-h-[400px]">
                        <div class="text-center">
                          <h3 class="text-lg font-medium mb-1">
                            {channel().channelName}
                          </h3>
                          <p class="text-sm">
                            Be the first to send a message in #{channel().channelName}
                          </p>
                        </div>
                      </div>
                    )}
                  </Show>
                }
              >
                <For each={messages()}>
                  {(message) => <MessageComponent message={message} type="channel" />}
                </For>
              </Show>
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
};

export default ChatContent;
