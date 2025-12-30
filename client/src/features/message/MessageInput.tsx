import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { Send, Paperclip, X, ReplyIcon } from "lucide-solid";
import FilePreview from "./FilePreview";
import { ContentEditable } from "@bigmistqke/solid-contenteditable";
import { useToaster } from "../../components/Toaster";
import { useChannel, useContext, useUser, useMessage } from "../../store/index";
import Button from "../../components/Button";
import EmojiPicker from "../../components/EmojiPicker";
import { formatLinks } from "../../utils/messageFormatting";


const formatContent = (text: string) => {
  if (!text) return <></>;
  return formatLinks(text, "text-link hover:underline", true);
};

const MessageInput: Component<{
  context: { type: "channel" | "dm"; id: number };
}> = (props) => {
  const [, channelActions] = useChannel();
  const [contextState, contextActions] = useContext();
  const [, userActions] = useUser();
  const [, messageActions] = useMessage();

  const [content, setContent] = createSignal("");
  const [files, setFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [uploadProgress, setUploadProgress] = createSignal<number | null>(null);
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);

  const isUploading = () => uploadProgress() !== null;

  let textareaRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const { addToast } = useToaster();

  const channel = createMemo(() =>
    props.context.type === "channel" ? channelActions.findById(props.context.id) : null
  );
  const dmUser = createMemo(() =>
    props.context.type === "dm" ? userActions.findById(props.context.id) : null
  );

  const replyingToMessage = createMemo(() => {
    const messageId = contextState.replyingToMessageId;
    if (!messageId) return null;
    return messageActions.findById(messageId) ?? null;
  });

  const replyingToUser = createMemo(() => {
    const message = replyingToMessage();
    if (!message) return null;
    return userActions.findById(message.senderId) ?? null;
  });

  const placeholder = createMemo(() => {
    if (props.context.type === "dm") {
      return dmUser() ? `Message @${dmUser()!.username}` : "Send a message...";
    }
    return channel()
      ? `Message #${channel()!.channelName}`
      : "Select a channel to start messaging";
  });

  const canSend = createMemo(() =>
    (content().trim().length > 0 || files().length > 0) && uploadProgress() === null
  );

  createEffect(() => {
    if (textareaRef && content()) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 120)}px`;
    }
  });

  const handleSubmit = async () => {
    if (!canSend()) return;

    const currentFiles = files();
    const controller = new AbortController();

    setAbortController(controller);
    setUploadProgress(0);

    const result = await messageActions.send(
      props.context.type,
      props.context.id,
      content().trim() || undefined,
      currentFiles,
      contextState.replyingToMessageId,
      setUploadProgress,
      controller.signal
    );

    setAbortController(null);
    setUploadProgress(null);

    if (result.isErr()) {
      if (result.error !== "Upload cancelled") {
        addToast(`Failed to send message: ${result.error}`, "error");
      }
      return;
    }

    setContent("");
    setFiles([]);
    contextActions.setReplyingTo(null);
    if (textareaRef) {
      textareaRef.innerText = "";
      textareaRef.style.height = "";
    }
  };

  const handleCancel = () => {
    abortController()?.abort();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const selectedFiles = Array.from(target.files || []);
    if (selectedFiles.length === 0) return;

    setFiles((prev) => [...prev, ...selectedFiles]);
    if (fileInputRef) fileInputRef.value = "";
  };

  const handleRemoveFile = (fileName: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== fileName));
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget || !(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  };

  return (
    <Show when={props.context}>
      <div class="p-4 bg-background">
        <Show when={replyingToMessage()}>
          <div class="mb-3 flex items-center gap-2 p-2 bg-accent border-l-2 border-primary">
            <ReplyIcon size={14} class="text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <span class="text-xs text-primary font-medium">
                {replyingToUser()?.username ?? "Unknown"}
              </span>
              <p class="text-sm text-muted-foreground truncate">
                {replyingToMessage()?.messageText || "Attachment"}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => contextActions.setReplyingTo(null)}
              title="Cancel reply"
            >
              <X size={16} />
            </Button>
          </div>
        </Show>

        <Show when={files().length > 0}>
          <div class="mb-3 flex flex-wrap gap-2 p-3 bg-background-dark rounded-lg border border-muted">
            <For each={files()}>
              {(file) => (
                <FilePreview
                  file={file}
                  onRemove={() => handleRemoveFile(file.name)}
                  disabled={isUploading()}
                />
              )}
            </For>
          </div>
        </Show>

        <Show when={isUploading()}>
          <div class="mb-3 px-1">
            <div class="flex items-center justify-between text-sm text-muted-foreground mb-1">
              <span>Uploading... {uploadProgress()}%</span>
              <Button size="sm" variant="ghost" onClick={handleCancel} title="Cancel upload">
                <X size={16} />
              </Button>
            </div>
            <div class="h-1 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full bg-link transition-all duration-150"
                style={{ width: `${uploadProgress()}%` }}
              />
            </div>
          </div>
        </Show>

        <div
          class={`relative flex items-center gap-3 py-3 px-1 bg-muted rounded-lg transition-colors ${isDragging() ? "bg-accent border-2 border-dashed border-link" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Button
            variant="ghost"
            onClick={() => fileInputRef?.click()}
            title="Attach files"
          >
            <Paperclip size={20} />
          </Button>

          <div class="flex-1 min-w-0 relative flex items-center">
            <ContentEditable
              ref={textareaRef}
              contentEditable
              editable
              textContent={content()}
              onTextContent={setContent}
              onKeyDown={handleKeyDown}
              data-placeholder={placeholder()}
              class="w-full bg-transparent text-foreground placeholder-muted-foreground-dark resize-none outline-none max-h-[120px] min-h-[24px] empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground-dark overflow-y-auto whitespace-pre-wrap break-words p-2 flex items-center"
              render={(content) => formatContent(content())}
            />
          </div>

          <EmojiPicker
            onSelect={(emoji) => {
              setContent((prev) => prev + emoji);
            }}
          />

          <Button
            variant="ghost"
            onClick={handleSubmit}
            disabled={!canSend()}
          >
            <Send size={20} />
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            class="hidden"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar"
          />
        </div>

        <Show when={isDragging()}>
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
            <div class="bg-background-dark bg-opacity-90 border-2 border-dashed border-link rounded-lg p-8 flex flex-col items-center justify-center">
              <div class="w-16 h-16 flex items-center justify-center rounded-full border-4 border-link border-dashed mb-4">
                <Paperclip size={32} class="text-link" />
              </div>
              <h2 class="text-xl font-semibold text-foreground-bright mb-2">Drop to Upload</h2>
              <p class="text-secondary-text">Files will be uploaded to this channel</p>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default MessageInput;
