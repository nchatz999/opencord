import type { Component } from "solid-js";
import { createSignal, createMemo, Show, For } from "solid-js";
import { Edit2Icon, ReplyIcon, Trash2Icon, CopyIcon, SmilePlus } from "lucide-solid";
import type { Message, User } from "../../model";

import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import EmojiPicker from "../../components/EmojiPicker";
import TextEditor from "../../components/TextEditor";
import { useToaster } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { useAuth, useContext, useMessage, useReaction, useUser } from "../../store/index";
import { extractYoutubeIds, formatMessageText, formatLinks } from "../../utils/messageFormatting";

import FileItem from "./File";
import MessageReactions from "./MessageReactions";
import Reply from "./Reply";

interface MessageProps {
  message: Message;
  type: "direct" | "channel";
}

const ownerFlex = (isOwner: boolean) => isOwner ? "flex-row-reverse" : "flex-row";
const ownerAlign = (isOwner: boolean) => isOwner ? "items-end" : "items-start";

const YouTubeEmbed: Component<{ id: string }> = (props) => (
  <a
    href={`https://www.youtube.com/watch?v=${props.id}`}
    target="_blank"
    rel="noopener noreferrer"
    class="block mt-2 w-full max-w-xs"
  >
    <div class="relative rounded-md border border-border-card overflow-hidden group">
      <img
        src={`https://img.youtube.com/vi/${props.id}/0.jpg`}
        alt="Youtube thumbnail"
        width={480}
        height={360}
        class="w-full h-auto object-cover group-hover:brightness-110 transition-all"
      />
      <div class="absolute top-1 right-1 bg-action-negative text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded">
        YouTube
      </div>
    </div>
  </a>
);

interface MessageHeaderProps {
  user: User;
  message: Message;
  isOwner: boolean;
}

const MessageHeader: Component<MessageHeaderProps> = (props) => (
  <div class={`flex items-center gap-2 ${ownerFlex(props.isOwner)}`}>
    <span class="text-dis-white font-semibold">{props.user.username}</span>
    <time class="text-muted-foreground text-xs">
      {new Date(props.message.createdAt).toLocaleString()}
    </time>
    <Show when={props.message.modifiedAt && props.message.modifiedAt !== props.message.createdAt}>
      <span class="text-muted-foreground text-xs">(edited)</span>
    </Show>
  </div>
);

interface MessageActionsProps {
  message: Message;
  isOwner: boolean;
  isEditing: boolean;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReaction: (emoji: string) => void;
}

const MessageActions: Component<MessageActionsProps> = (props) => (
  <div class={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${ownerFlex(props.isOwner)}`}>
    <EmojiPicker onSelect={props.onReaction} size="sm" icon={<SmilePlus size={16} />} />
    <Button size="sm" variant="ghost" onClick={props.onReply} title="Reply">
      <ReplyIcon size={16} />
    </Button>
    <Show when={props.message.messageText}>
      <Button size="sm" variant="ghost" onClick={props.onCopy} title="Copy">
        <CopyIcon size={16} />
      </Button>
    </Show>
    <Show when={props.isOwner && !props.isEditing && props.message.messageText}>
      <Button size="sm" variant="ghost" onClick={props.onEdit} title="Edit">
        <Edit2Icon size={16} />
      </Button>
    </Show>
    <Button size="sm" variant="ghost" onClick={props.onDelete} title="Delete">
      <Trash2Icon size={16} />
    </Button>
  </div>
);

interface MessageEditProps {
  content: string;
  onInput: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

const MessageEdit: Component<MessageEditProps> = (props) => (
  <div class="flex flex-col gap-2">
    <TextEditor
      value={props.content}
      onInput={props.onInput}
      format={(text) => formatLinks(text, "text-link hover:underline")}
      maxHeight={600}
      class="min-w-48 max-w-2xl"
    />
    <div class="flex gap-2 mt-2">
      <Button size="sm" variant="primary" onClick={props.onSave}>Save</Button>
      <Button size="sm" variant="secondary" onClick={props.onCancel}>Cancel</Button>
    </div>
  </div>
);

interface MessageContentProps {
  text: string;
  isOwner: boolean;
  type: "direct" | "channel";
  youtubeIds: string[];
}

const MessageContent: Component<MessageContentProps> = (props) => (
  <>
    <span class="text-foreground font-normal break-words whitespace-pre-wrap">
      {formatMessageText(props.text, props.isOwner, props.type)}
    </span>
    <For each={props.youtubeIds}>{(id) => <YouTubeEmbed id={id} />}</For>
  </>
);

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
