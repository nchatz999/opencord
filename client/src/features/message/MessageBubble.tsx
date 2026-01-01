import type { Component } from "solid-js";
import { createSignal, createMemo, Show, For } from "solid-js";
import type { Message } from "../../model";

import Avatar from "../../components/Avatar";
import { useToaster } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useAuth, useContext, useMessage, useReaction, useUser } from "../../store/index";
import { extractYoutubeIds } from "../../utils/messageFormatting";

import FileItem from "./File";
import MessageReactions from "./MessageReactions";
import Reply from "./Reply";
import MessageHeader from "./MessageHeader";
import MessageActions from "./MessageActions";
import MessageEdit from "./MessageEdit";
import MessageContent from "./MessageContent";

interface MessageProps {
  message: Message;
  type: "direct" | "channel";
}

export const ownerFlex = (isOwner: boolean) => isOwner ? "flex-row-reverse" : "flex-row";
export const ownerAlign = (isOwner: boolean) => isOwner ? "items-end" : "items-start";

const MessageComponent: Component<MessageProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editedContent, setEditedContent] = createSignal(props.message.messageText || "");

  const { addToast } = useToaster();
  const confirm = useConfirm();
  const [, authActions] = useAuth();
  const [, contextActions] = useContext();
  const [, messageActions] = useMessage();
  const [, reactionActions] = useReaction();
  const [, userActions] = useUser();

  const isAuthor = createMemo(() => authActions.getUser().userId === props.message.senderId);
  const youtubeIds = createMemo(() => extractYoutubeIds(props.message.messageText));
  const attachments = createMemo(() => messageActions.getAttachments(props.message.id));

  const handleSaveEdit = async () => {
    const trimmed = editedContent().trim();
    if (!trimmed) return addToast("Message content cannot be empty", "error");
    if (trimmed === props.message.messageText) return setIsEditing(false);

    const result = await messageActions.updateMessage(props.message.id, trimmed);
    if (result.isErr()) addToast(`Error: ${result.error}`, "error");
  };

  const handleCancelEdit = () => {
    setEditedContent(props.message.messageText || "");
    setIsEditing(false);
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Message",
      message: "Are you sure you want to delete this message?",
      confirmText: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    const result = await messageActions.delete(props.message.id);
    if (result.isErr()) addToast(`Error: ${result.error}`, "error");
  };

  const handleCopy = async () => {
    if (!props.message.messageText) return;
    await navigator.clipboard.writeText(props.message.messageText);
    addToast("Message copied", "success");
  };

  const handleAddReaction = async (emoji: string) => {
    const result = await reactionActions.addReaction(props.message.id, emoji);
    if (result.isErr()) addToast(`Failed to add reaction: ${result.error}`, "error");
  };

  return (
    <Show when={userActions.findById(props.message.senderId)}>
      {(user) => (
        <div
          id={`message-${props.message.id}`}
          class={`flex p-2 ${isAuthor() ? "justify-end" : "justify-start"}`}
        >
          <div class={`flex flex-col group max-w-[85%] ${ownerAlign(isAuthor())}`}>
            <div class={`flex items-center gap-3 ${ownerFlex(isAuthor())}`}>
              <Avatar avatarFileId={user().avatarFileId} alt={`${user().username}'s avatar`} size="md" />
              <MessageHeader user={user()} message={props.message} isOwner={isAuthor()} />
              <MessageActions
                message={props.message}
                isOwner={isAuthor()}
                isEditing={isEditing()}
                onReply={() => contextActions.setReplyingTo(props.message.id)}
                onCopy={handleCopy}
                onEdit={() => setIsEditing(true)}
                onDelete={handleDelete}
                onReaction={handleAddReaction}
              />
            </div>

            <div class={`flex gap-3 ${ownerFlex(isAuthor())}`}>
              <div class="w-10 shrink-0" />
              <div class={`flex flex-col gap-2 min-w-0 ${ownerAlign(isAuthor())}`}>
                <Show when={props.message.replyToMessageId}>
                  <Reply messageId={props.message.replyToMessageId!} />
                </Show>

                <Show when={props.message.messageText}>
                  <div class="rounded-lg px-4 py-2 bg-muted hover:bg-opacity-90 transition-colors duration-200 max-w-2xl">
                    <Show
                      when={isEditing()}
                      fallback={
                        <MessageContent
                          text={props.message.messageText!}
                          isOwner={isAuthor()}
                          type={props.type}
                          youtubeIds={youtubeIds()}
                        />
                      }
                    >
                      <MessageEdit
                        content={editedContent()}
                        onInput={setEditedContent}
                        onSave={handleSaveEdit}
                        onCancel={handleCancelEdit}
                      />
                    </Show>
                  </div>
                </Show>

                <Show when={attachments().length > 0}>
                  <div class="flex flex-col gap-2 mt-2">
                    <For each={attachments()}>{(file) => <FileItem file={file} />}</For>
                  </div>
                </Show>

                <MessageReactions messageId={props.message.id} isAuthor />
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default MessageComponent;
