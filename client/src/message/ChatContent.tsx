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
import { useChannel, useFile, useMessage, useUser, useContext } from "../store/index";
import { useToaster } from "../components/Toaster";
import MessageComponent from "./Message";


const MESSAGES_LIMIT = 50;
const SCROLL_THRESHOLD = 5;
const BOTTOM_THRESHOLD = 100;

const waitForImages = (container: HTMLElement): Promise<void> => {
  const images = container.querySelectorAll('img');
  const promises = Array.from(images).map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    });
  });
  return Promise.all(promises).then(() => { });
};

const ChatContent: Component = () => {
  const [, channelActions] = useChannel();
  const [, fileActions] = useFile();
  const [messageState, messageActions] = useMessage();
  const [, userActions] = useUser();
  const [contextState] = useContext();

  let messagesEndRef: HTMLDivElement | undefined;
  let messagesContainerRef: HTMLDivElement | undefined;

  const [isLoadingMore, setIsLoadingMore] = createSignal(false);

  const { addToast } = useToaster();

  const ctx = createMemo(() => contextState.context);

  const messages = () => {
    const context = ctx();
    if (!context) return [];
    return context.type === "dm"
      ? messageActions.findByRecipient(context.id)
      : messageActions.findByChannel(context.id);
  };

  const latestMessageId = createMemo(() => {
    const msgs = messages();
    return msgs.length > 0 ? msgs[msgs.length - 1].id : null;
  });

  const isNearBottom = (): boolean => {
    if (!messagesContainerRef) return true;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef;
    return scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD;
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (messagesContainerRef) {
        messagesContainerRef.scrollTop = messagesContainerRef.scrollHeight;
      }
    });
  };

  const scrollToBottomIfNeeded = async (forceScroll = false) => {
    if (!messagesContainerRef) return;
    if (!forceScroll && !isNearBottom()) return;
    await waitForImages(messagesContainerRef);
    scrollToBottom();
  };

  const loadMoreMessages = async () => {
    const context = ctx();
    const msgs = messages();
    if (!context || isLoadingMore()) return;
    setIsLoadingMore(true);
    const container = messagesContainerRef!;
    const previousScrollHeight = container.scrollHeight;
    const firstMessage = msgs[0];

    const createdAt = firstMessage
      ? firstMessage.createdAt
      : new Date().toISOString();

    const result = await messageActions.fetchMessages(
      context.type,
      context.id,
      MESSAGES_LIMIT,
      createdAt
    );

    if (result.isErr()) {
      addToast(`Error: ${result.error}`, "error");
      setIsLoadingMore(false);
      return;
    }

    await fileActions.fetchFiles(context.type, context.id, MESSAGES_LIMIT, createdAt);

    requestAnimationFrame(() => {
      const scrollHeightDiff = container.scrollHeight - previousScrollHeight;
      container.scrollTop += scrollHeightDiff;
    });

    setIsLoadingMore(false);
  };


  const handleScroll = () => {
    const container = messagesContainerRef;
    if (!container) return;


    if (container.scrollTop < SCROLL_THRESHOLD) {
      loadMoreMessages();
    }
  };

  createEffect(on(ctx, async () => {
    if (messages().length == 0) {
      await loadMoreMessages();
    }
    scrollToBottomIfNeeded(true);
  }));

  createEffect(on(
    latestMessageId,
    (newId, prevId) => {
      if (newId !== prevId) {
        scrollToBottomIfNeeded();
      }
    }
  ));


  return (
    <div
      ref={messagesContainerRef}
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
                <div ref={messagesEndRef} />
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
                <div ref={messagesEndRef} />
              </Show>
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
};

export default ChatContent;
