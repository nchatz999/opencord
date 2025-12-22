import type { Component } from "solid-js";
import { createSignal, createMemo, Show, For } from "solid-js";
import FileItem from "./File";
import { Edit2Icon, ReplyIcon, Trash2Icon, CopyIcon } from "lucide-solid";
import { ContentEditable } from "@bigmistqke/solid-contenteditable";
import type { Message } from "../../model";
import { useToaster } from "../../components/Toaster";
import { useAuth, useMessage, useUser } from "../../store/index";
import Button from "../../components/Button";
import { useConfirm } from "../../components/ConfirmDialog";
import { formatLinks, formatMessageText, extractYoutubeIds } from "../../utils/messageFormatting";

interface MessageProps {
  message: Message;
  type: "direct" | "channel";
}

const MessageComponent: Component<MessageProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editedContent, setEditedContent] = createSignal(props.message.messageText || "");
  const { addToast } = useToaster();
  const confirm = useConfirm();
  const [, authActions] = useAuth();
  const [, messageActions] = useMessage();
  const [, userActions] = useUser();
  const currentUser = () => authActions.getUser();

  const isOwner = createMemo(() => currentUser().userId === props.message.senderId);
  const youtubeIds = createMemo(() => extractYoutubeIds(props.message.messageText));

  const handleSaveEdit = async () => {
    const trimmed = editedContent().trim();
    if (!trimmed) {
      addToast("Message content cannot be empty", "error");
      return;
    }

    if (trimmed === props.message.messageText) {
      setIsEditing(false);
      return;
    }

    const result = await messageActions.updateMessage(props.message.id, trimmed);

    if (result.isErr()) {
      addToast(`Error: ${result.error}`, "error");
    }
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

    if (result.isErr()) {
      addToast(`Error: ${result.error}`, "error");
    }
  };

  const handleCopy = async () => {
    if (!props.message.messageText) return;
    await navigator.clipboard.writeText(props.message.messageText);
    addToast("Message copied", "success");
  };

  return (
    <Show when={userActions.findById(props.message.senderId)}>
      {(user) => (
        <div class={`flex p-2 ${isOwner() ? "justify-end" : "justify-start"}`}>
          <div class={`flex flex-col group max-w-[70%] ${isOwner() ? "items-end" : "items-start"}`}>
            <div class={`flex gap-3 ${isOwner() ? "flex-row-reverse" : "flex-row"}`}>
              <img
                class="w-10 h-10 rounded-full flex-shrink-0"
                src={`/user/${user().avatarFileId}/avatar`}
                alt={`${user().username}'s avatar`}
                width={40}
                height={40}
              />

              <div class={`flex flex-col min-w-0 ${isOwner() ? "items-end" : "items-start"}`}>
                <div class={`flex items-baseline gap-2 ${isOwner() ? "flex-row-reverse" : "flex-row"}`}>
                  <span class="text-dis-white font-semibold">{user().username}</span>
                  <time class="text-muted-foreground text-xs">
                    {new Date(props.message.createdAt).toLocaleString()}
                  </time>
                  <Show when={props.message.modifiedAt && props.message.modifiedAt !== props.message.createdAt}>
                    <span class="text-muted-foreground text-xs">(edited)</span>
                  </Show>
                </div>

                <Show when={props.message.replyToMessageId}>
                  <div class="text-muted-foreground text-sm mb-1">
                    <ReplyIcon size={12} class="inline mr-1" />
                    Replying to a message
                  </div>
                </Show>

                <div class={`flex flex-col gap-2 ${isOwner() ? "items-end" : "items-start"}`}>
                  <Show when={props.message.messageText}>
                    <div class="rounded-lg px-4 py-2 bg-muted hover:bg-opacity-90 transition-colors duration-200 max-w-md">
                      <Show when={isEditing()} fallback={
                        <>
                          <span class="text-foreground font-normal break-words">
                            {formatMessageText(props.message.messageText || '', isOwner(), props.type)}
                          </span>
                          <For each={youtubeIds()}>
                            {(id) => (
                              <a
                                href={`https://www.youtube.com/watch?v=${id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="block mt-2 w-full max-w-xs"
                              >
                                <div class="relative rounded-md border border-border-card overflow-hidden group">
                                  <img
                                    src={`https://img.youtube.com/vi/${id}/0.jpg`}
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
                            )}
                          </For>
                        </>
                      }>
                        <div class="flex flex-col gap-2">
                          <ContentEditable
                            textContent={editedContent()}
                            onTextContent={setEditedContent}
                            render={(content) => formatLinks(content(), "text-link hover:underline")}
                            class="min-h-[50px] w-auto overflow-auto max-h-[50vh] bg-transparent text-foreground resize-none outline-none overflow-x-hidden whitespace-pre-wrap break-words p-1"
                          />
                          <div class="flex gap-2 mt-2">
                            <Button size="sm" variant="primary" onClick={handleSaveEdit}>Save</Button>
                            <Button size="sm" variant="secondary" onClick={handleCancelEdit}>Cancel</Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={messageActions.getAttachments(props.message.id).length > 0}>
                    <div class="flex flex-col gap-2 mt-2">
                      <For each={messageActions.getAttachments(props.message.id)}>
                        {(file) => <FileItem file={file} />}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>

              <div class={`flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isOwner() ? "flex-row-reverse" : "flex-row"}`}>
                <Show when={props.message.messageText}>
                  <Button size="sm" variant="ghost" onClick={handleCopy} title="Copy">
                    <CopyIcon size={16} />
                  </Button>
                </Show>
                <Show when={isOwner() && !isEditing()}>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} title="Edit">
                    <Edit2Icon size={16} />
                  </Button>
                </Show>
                <Button size="sm" variant="ghost" onClick={handleDelete} title="Delete">
                  <Trash2Icon size={16} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default MessageComponent;
