import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { Send, Paperclip, Smile } from "lucide-solid";
import FilePreview from "./FilePreview";
import { ContentEditable } from "@bigmistqke/solid-contenteditable";
import { useToaster } from "../components/Toaster";
import { useChannel, useUser, useMessage } from "../store/index";
import { toBase64 } from "../utils";
import Button from "../components/Button";
import { formatLinks } from "../utils/messageFormatting";

const formatContent = (text: string) => {
  if (!text) return <></>;
  return formatLinks(text, "text-link hover:underline", true);
};

const MessageInput: Component<{
  context: { type: "channel" | "dm"; id: number };
}> = (props) => {
  const [, channelActions] = useChannel();
  const [, userActions] = useUser();
  const [, messageActions] = useMessage();

  const [content, setContent] = createSignal("");
  const [files, setFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);

  let textareaRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const { addToast } = useToaster();

  const channel = createMemo(() =>
    props.context.type === "channel" ? channelActions.findById(props.context.id) : null
  );
  const dmUser = createMemo(() =>
    props.context.type === "dm" ? userActions.findById(props.context.id) : null
  );

  const placeholder = createMemo(() => {
    if (props.context.type === "dm") {
      return dmUser() ? `Message @${dmUser()!.username}` : "Send a message...";
    }
    return channel()
      ? `Message #${channel()!.channelName}`
      : "Select a channel to start messaging";
  });

  createEffect(() => {
    if (textareaRef && content()) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 120)}px`;
    }
  });

  const handleSubmit = async () => {
    const fileUploads = await Promise.all(
      files().map(async (file) => ({
        fileName: file.name,
        contentType: file.type,
        data: await toBase64(file),
      }))
    );

    const result = await messageActions.send(
      props.context.type,
      props.context.id,
      content().trim() || undefined,
      fileUploads
    );

    if (result.isErr()) {
      addToast(`Failed to send message: ${result.error}`, "error");
      return;
    }

    setContent("");
    setFiles([]);
    if (textareaRef) {
      textareaRef.innerText = "";
      textareaRef.style.height = "";
    }
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
        <Show when={files().length > 0}>
          <div class="mb-3 flex flex-wrap gap-2 p-3 bg-background-dark rounded-lg border border-muted">
            <For each={files()}>
              {(file) => (
                <FilePreview
                  file={file}
                  onRemove={() => handleRemoveFile(file.name)}
                />
              )}
            </For>
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

          <Button variant="ghost" title="Add emoji" disabled>
            <Smile size={20} />
          </Button>

          <Button
            variant="ghost"
            onClick={handleSubmit}
            disabled={content().trim().length == 0}
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
