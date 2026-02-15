import type { Component } from "solid-js";
import { createSignal, createMemo, For, Show } from "solid-js";
import { Send, Paperclip, X, ReplyIcon } from "lucide-solid";
import FilePreview from "./FilePreview";
import TextEditor from "../../components/TextEditor";
import { useToaster } from "../../components/Toaster";
import { useChannel, useContext, useUser, useMessage, useServer } from "../../store/index";
import Button from "../../components/Button";
import EmojiPicker from "../../components/EmojiPicker";
import { formatLinks } from "../../utils/messageFormatting";

const MessageInput: Component<{
    context: { type: "channel" | "dm"; id: number };
}> = (props) => {
    const [, channelActions] = useChannel();
    const [contextState, contextActions] = useContext();
    const [, userActions] = useUser();
    const [, messageActions] = useMessage();
    const [, serverActions] = useServer();

    const [content, setContent] = createSignal("");
    const [files, setFiles] = createSignal<File[]>([]);
    const [isDragging, setIsDragging] = createSignal(false);
    const [uploadProgress, setUploadProgress] = createSignal<number | null>(null);
    const [abortController, setAbortController] = createSignal<AbortController | null>(null);

    const isUploading = () => uploadProgress() !== null;

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

    const addFiles = (newFiles: File[]) => {
        const config = serverActions.get();
        for (const f of newFiles) {
            if (config && f.size > config.maxFileSizeMb * 1024 * 1024) {
                addToast(`File exceeds ${config.maxFileSizeMb} MB limit`, "error");
                continue;
            }
            if (config && files().length >= config.maxFilesPerMessage) {
                addToast(`Maximum ${config.maxFilesPerMessage} files per message`, "error");
                break;
            }
            setFiles((prev) => [...prev, f]);
        }
    };

    const handleFileSelect = (e: Event) => {
        const target = e.target as HTMLInputElement;
        addFiles(Array.from(target.files || []));
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
        addFiles(Array.from(e.dataTransfer?.files || []));
    };

    const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];
        for (const item of items) {
            if (item.kind === "file") {
                const file = item.getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        addFiles(pastedFiles);
    };

    return (
        <Show when={props.context}>
            <div class="p-4 bg-bg-base relative">
                <Show when={replyingToMessage()}>
                    <div class="mb-3 flex items-center gap-2 p-2 bg-bg-emphasis border-l-2 border-accent-primary">
                        <ReplyIcon size={14} class="text-fg-muted shrink-0" />
                        <div class="flex-1 min-w-0">
                            <span class="text-xs text-accent-primary font-medium">
                                {replyingToUser()?.username ?? "Unknown"}
                            </span>
                            <p class="text-sm text-fg-muted truncate">
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
                    <div class="absolute bottom-full left-0 right-0 mb-2 mx-4 flex flex-wrap gap-2 p-3 bg-bg-subtle rounded-lg border border-border-base shadow-lg">
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
                        <div class="flex items-center justify-between text-sm text-fg-muted mb-1">
                            <span>Uploading... {uploadProgress()}%</span>
                            <Button size="sm" variant="ghost" onClick={handleCancel} title="Cancel upload">
                                <X size={16} />
                            </Button>
                        </div>
                        <div class="h-1 bg-bg-overlay rounded-full overflow-hidden">
                            <div
                                class="h-full bg-accent-link transition-all duration-150"
                                style={{ width: `${uploadProgress()}%` }}
                            />
                        </div>
                    </div>
                </Show>

                <div
                    class={`relative flex items-center gap-3 py-3 px-1 bg-bg-overlay rounded-lg transition-colors ${isDragging() ? "bg-bg-emphasis border-2 border-dashed border-accent-link" : ""}`}
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

                    <TextEditor
                        value={content()}
                        onInput={setContent}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        placeholder={placeholder()}
                        format={(text) => formatLinks(text, "text-accent-link", true)}
                        class="flex-1 min-w-0"
                    />

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
                        <div class="bg-bg-subtle bg-opacity-90 border-2 border-dashed border-accent-link rounded-lg p-8 flex flex-col items-center justify-center">
                            <div class="w-16 h-16 flex items-center justify-center rounded-full border-4 border-accent-link border-dashed mb-4">
                                <Paperclip size={32} class="text-accent-link" />
                            </div>
                            <h2 class="text-xl font-semibold text-fg-emphasis mb-2">Drop to Upload</h2>
                            <p class="text-fg-subtle">Files will be uploaded to this channel</p>
                        </div>
                    </div>
                </Show>
            </div>
        </Show>
    );
};

export default MessageInput;
