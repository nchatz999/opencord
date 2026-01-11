import type { Component } from "solid-js";
import { createSignal, createEffect, onCleanup } from "solid-js";
import { Trash2, FileText, Video } from "lucide-solid";
import Button from "../../components/Button";

interface FilePreviewProps {
    file: File;
    onRemove: () => void;
    disabled?: boolean;
}

const FilePreview: Component<FilePreviewProps> = (props) => {
    const [imageUrl, setImageUrl] = createSignal<string | null>(null);
    const isImage = () => props.file.type.startsWith("image/");

    createEffect(() => {

        if (isImage()) {
            const url = URL.createObjectURL(props.file);
            setImageUrl(url);


            onCleanup(() => URL.revokeObjectURL(url));
        }
    });

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + " B";
        else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    };

    return (
        <div class="relative bg-sidebar rounded-lg overflow-hidden group">
            <Button
                variant="ghost"
                size="sm"
                class="absolute top-2 right-2 z-10 p-1.5 bg-background opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={props.onRemove}
                disabled={props.disabled}
                title="Remove file"
            >
                <Trash2 class="text-destructive" size={16} />
            </Button>

            {isImage() && imageUrl() ? (
                <div class="w-44 h-44 relative">
                    <img
                        src={imageUrl()!}
                        alt={props.file.name}
                        class="w-full h-full object-cover"
                    />
                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                        <p class="text-xs text-white truncate">{props.file.name}</p>
                    </div>
                </div>
            ) : (
                <div class="w-44 h-44 flex flex-col items-center justify-center p-4">
                    {props.file.type.startsWith("video/") ? (
                        <Video class="text-primary" size={48} />
                    ) : props.file.type.includes("pdf") ? (
                        <FileText class="text-destructive" size={48} />
                    ) : (
                        <FileText class="text-primary" size={48} />
                    )}
                    <div class="mt-3 text-center w-full">
                        <p class="text-sm text-foreground truncate">{props.file.name}</p>
                        <p class="text-xs text-muted-foreground mt-1">
                            {formatFileSize(props.file.size)}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FilePreview;
