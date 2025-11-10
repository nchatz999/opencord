import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { Send, Paperclip, Smile } from "lucide-solid";
import FilePreview from "./FilePreview";
import { ContentEditable } from "@bigmistqke/solid-contenteditable";
import { useToaster } from "../components/Toaster";
import { channelDomain, userDomain } from "../store";
import { fetchApi, toBase64 } from "../utils";

const MessageInput: Component<{
  context: { type: "channel" | "dm"; id: number };
}> = (props) => {
  const [content, setContent] = createSignal("");

  const formatContent = (text: string) => {
    if (!text) return <></>;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return (
      <>
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <a
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              class="text-[#00A8FC] hover:underline"
              onClick={(e) => e.preventDefault()}
            >
              {part}
            </a>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const handleInput = (e: string) => {
    setContent(e);
  };

  const [files, setFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isSending, setIsSending] = createSignal(false);

  let textareaRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const { addToast } = useToaster();

  const channel = createMemo(() =>
    props.context.type === "channel" ? channelDomain.findById(props.context.id) : null
  );
  const dmUser = createMemo(() =>
    props.context.type === "dm" ? userDomain.findById(props.context.id) : null
  );

  const placeholder = createMemo(() => {
    if (props.context.type === "dm") {
      return dmUser() ? `Message @${dmUser()!.username}` : "Send a message...";
    } else {
      return channel()
        ? `Message #${channel()!.channelName}`
        : "Select a channel to start messaging";
    }
  });

  createEffect(() => {
    if (textareaRef && content()) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 120)}px`;
    }
  });

  const handleSubmit = async () => {
    if (!content().trim() && files().length === 0) return;
    if (!userDomain.getCurrent()) return;
    if (isSending()) return;

    setIsSending(true);

    try {
      const fileUploads = await Promise.all(
        files().map(async (file) => ({
          fileName: file.name,
          contentType: file.type,
          data: await toBase64(file),
        }))
      );

      const messageData = {
        messageText: content().trim() || undefined,
        files: fileUploads,
      };

      const result = await fetchApi(`/message/${props.context.type}/${props.context.id}/messages`, {
        method: "POST",
        body: messageData,
      });

      if (result.ok) {
        setContent("");
        setFiles([]);
        if (textareaRef) {
          textareaRef.innerText = "";
          textareaRef.style.height = "";
        }
      } else {
        addToast(`Failed to send message: ${result.error.reason}`, "error");
      }
    } catch (error) {
      addToast("Error sending message", "error");
    } finally {
      setIsSending(false);
      textareaRef?.focus();
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

    if (fileInputRef) {
      fileInputRef.value = "";
    }
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
    if (
      !e.currentTarget ||
      !(e.currentTarget as Element).contains(e.relatedTarget as Node)
    ) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer?.files || []);
    if (droppedFiles.length === 0) return;

    setFiles((prev) => [...prev, ...droppedFiles]);
  };

  return (
    <Show when={props.context}>
      <div class="p-4 bg-[#313338]">

        <Show when={files().length > 0}>
          <div class="mb-3 flex flex-wrap gap-2">
            <For each={files()}>
              {(file, _index) => (
                <FilePreview
                  file={file}
                  onRemove={() => handleRemoveFile(file.name)}
                />
              )}
            </For>
          </div>
        </Show>

        <div
          class={`relative flex items-end gap-3 py-3 px-1 bg-[#383a40] rounded-lg transition-colors ${isDragging()
            ? "bg-[#404249] border-2 border-dashed border-[#00A8FC]"
            : ""
            }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <button
            onClick={() => fileInputRef?.click()}
            class="p-2 text-[#949ba4] hover:text-[#DBDEE1] transition-colors hover:bg-[#2e3035] rounded"
            title="Attach files"
          >
            <Paperclip size={20} />
          </button>

          <div class="flex-1 min-w-0 relative">
            <ContentEditable
              ref={textareaRef}
              contentEditable
              editable
              textContent={content()}
              onTextContent={handleInput}
              onKeyDown={handleKeyDown}
              data-placeholder={placeholder()}
              class="w-full bg-transparent text-[#DBDEE1] placeholder-[#6c7177] resize-none outline-none max-h-[120px] min-h-[24px] empty:before:content-[attr(data-placeholder)] empty:before:text-[#6c7177] overflow-y-auto whitespace-pre-wrap break-words p-1"
              render={(content) => formatContent(content())}
            />
          </div>

          <button
            class="p-2 text-[#949ba4] hover:text-[#DBDEE1] transition-colors hover:bg-[#2e3035] rounded"
            title="Add emoji"
            disabled
          >
            <Smile size={20} />
          </button>

          <button
            onClick={handleSubmit}
            disabled={
              (!content().trim() && files().length === 0) || isSending()
            }
            class={`
              p-2 rounded transition-colors
              ${(content().trim() || files().length > 0) && !isSending()
                ? "text-[#DBDEE1] hover:bg-[#00A8FC] hover:text-white"
                : "text-[#6c7177] cursor-not-allowed"
              }
            `}
            title={isSending() ? "Sending..." : "Send message"}
          >
            <Show
              when={!isSending()}
              fallback={
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
              }
            >
              <Send size={20} />
            </Show>
          </button>

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
            <div class="bg-[#1e1f22] bg-opacity-90 border-2 border-dashed border-[#00A8FC] rounded-lg p-8 flex flex-col items-center justify-center">
              <div class="w-16 h-16 flex items-center justify-center rounded-full border-4 border-[#00A8FC] border-dashed mb-4">
                <Paperclip size={32} class="text-[#00A8FC]" />
              </div>
              <h2 class="text-xl font-semibold text-[#f2f3f5] mb-2">
                Drop to Upload
              </h2>
              <p class="text-[#b5bac1]">
                Files will be uploaded to this channel
              </p>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default MessageInput;
