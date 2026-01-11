import type { Component } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import { Paperclip } from "lucide-solid";
import { useMessage, useUser, useContext } from "../../store/index";

interface ReplyProps {
    messageId: number;
}

const Reply: Component<ReplyProps> = (props) => {
    const [, messageActions] = useMessage();
    const [, userActions] = useUser();
    const [contextState] = useContext();

    const [isLoading, setIsLoading] = createSignal(false);

    const isDeleted = () => props.messageId === -1;
    const message = createMemo(() => messageActions.findById(props.messageId));
    const author = createMemo(() => {
        const msg = message();
        if (!msg) return null;
        return userActions.findById(msg.senderId);
    });
    const hasAttachments = createMemo(() => {
        const msg = message();
        if (!msg) return false;
        return messageActions.getAttachments(msg.id).length > 0;
    });

    const truncateText = (text: string, maxLength: number) => {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength) + "...";
    };

    const handleClick = async () => {
        if (isDeleted()) return;

        if (message()) {
            document.getElementById(`message-${props.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }

        const context = contextState.context;
        if (!context) return;

        const contextMessages = context.type === "dm"
            ? messageActions.findByRecipient(context.id)
            : messageActions.findByChannel(context.id);
        const oldestMessage = contextMessages[0];
        if (!oldestMessage) return;

        setIsLoading(true);
        await messageActions.fetchMessagesRange(context.type, context.id, oldestMessage.id, props.messageId);
        setIsLoading(false);

        requestAnimationFrame(() => {
            document.getElementById(`message-${props.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    };

    return (
        <Show
            when={!isDeleted()}
            fallback={
                <div class="flex items-center gap-2 mb-1 px-2 py-1 bg-muted/50 border-l-2 border-muted-foreground">
                    <span class="text-xs text-muted-foreground italic">Original message was deleted</span>
                </div>
            }
        >
            <Show
                when={message()}
                fallback={
                    <div
                        class="flex items-center gap-2 mb-1 px-2 py-1 bg-muted/50 border-l-2 border-primary cursor-pointer hover:bg-muted/70"
                        onClick={handleClick}
                    >
                        <span class="text-xs text-muted-foreground italic">
                            {isLoading() ? "Loading..." : "Click to load message"}
                        </span>
                    </div>
                }
            >
                {(msg) => (
                    <div
                        class="flex items-center mb-1 bg-accent p-2 text-sm cursor-pointer hover:bg-accent/80"
                        onClick={handleClick}
                    >
                        <div class="w-1 h-full bg-primary mr-2 rounded-full"></div>
                        <div class="flex flex-col flex-grow overflow-hidden">
                            <div class="flex items-center">
                                <span class="font-medium text-primary mr-2">
                                    {author()?.username ?? "Unknown"}
                                </span>
                                <Show when={hasAttachments()}>
                                    <Paperclip class="w-3 h-3 text-muted-foreground" />
                                </Show>
                            </div>
                            <Show when={msg().messageText}>
                                <span class="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                                    {truncateText(msg().messageText || "", 100)}
                                </span>
                            </Show>
                            <Show when={!msg().messageText && hasAttachments()}>
                                <span class="text-muted-foreground italic">Attachment</span>
                            </Show>
                        </div>
                    </div>
                )}
            </Show>
        </Show>
    );
};

export default Reply;
