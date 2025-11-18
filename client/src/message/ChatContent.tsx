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
import { channelDomain, fileDomain, messageDomain, userDomain } from "../store";
import { useToaster } from "../components/Toaster";
import type { File, Message } from "../model";
import { fetchApi } from "../utils";
import MessageComponent from "./Message";


const MESSAGES_LIMIT = 50;
const SCROLL_THRESHOLD = 5;

const ChatContent: Component = () => {

  let messagesEndRef: HTMLDivElement | undefined;
  let messagesContainerRef: HTMLDivElement | undefined;

  const [isLoadingMore, setIsLoadingMore] = createSignal(false);

  const { addToast } = useToaster();

  const ctx = createMemo(() => messageDomain.getContext());

  const messages = () => {
    const context = ctx();
    if (!context) return [];
    return context.type === "dm"
      ? messageDomain.findByRecipient(context.id)
      : messageDomain.findByChannel(context.id);
  };

  const latestMessageId = createMemo(() => {
    const msgs = messages();
    return msgs.length > 0 ? msgs[msgs.length - 1].id : null;
  });


  const scrollToBottom = () => {
    if (messagesEndRef)
      messagesEndRef.scrollIntoView({ behavior: "smooth" });
  };

  const loadMoreMessages = async () => {
    const context = ctx();
    const msgs = messages();
    if (!context || isLoadingMore()) return;
    setIsLoadingMore(true);
    const container = messagesContainerRef!;
    const previousScrollHeight = container.scrollHeight;
    const firstMessage = msgs[0];

    try {
      let createdAt;
      if (firstMessage)
        createdAt = firstMessage.createdAt
      else
        createdAt = new Date().toISOString()
      const messagesEndpoint = context.type === "dm"
        ? `/message/dm/${context.id}/messages`
        : `/message/channel/${context.id}/messages`;

      const result = await fetchApi<Message[]>(messagesEndpoint, {
        method: "GET",
        query: {
          limit: MESSAGES_LIMIT,
          timestamp: createdAt
        }
      });
      if (!result.ok) {
        addToast(`Error: ${result.error.reason}`, "error");
        return;
      }
      messageDomain.insertMany(result.value);
      const filesEndpoint = context.type === "dm"
        ? `/message/dm/${context.id}/files`
        : `/message/channel/${context.id}/files`;

      const filesResult = await fetchApi<File[]>(filesEndpoint, {
        method: "GET",
        query: {
          limit: MESSAGES_LIMIT,
          timestamp: createdAt
        }
      });
      if (filesResult.ok) {
        fileDomain.addMany(filesResult.value);
      }

      requestAnimationFrame(() => {
        const scrollHeightDiff = container.scrollHeight - previousScrollHeight;
        container.scrollTop += scrollHeightDiff;
      });
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };


  const handleScroll = () => {
    const container = messagesContainerRef;
    if (!container) return;


    if (container.scrollTop < SCROLL_THRESHOLD) {
      loadMoreMessages();
    }
  };




  createEffect(on(ctx, () => {
    if (messages().length == 0) {
      loadMoreMessages()
      setTimeout(scrollToBottom, 500);
    }
  }));


  createEffect(on(
    latestMessageId,
    (newId, prevId) => {
      if (newId !== prevId) {
        setTimeout(scrollToBottom, 500);
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
                  <Show when={userDomain.findById(context().id)}>
                    {(user) => (
                      <div class="flex-1 flex items-center justify-center text-[#949ba4] min-h-[400px]">
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
                  <Show when={channelDomain.findById(context().id)}>
                    {(channel) => (
                      <div class="flex-1 flex items-center justify-center text-[#949ba4] min-h-[400px]">
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
