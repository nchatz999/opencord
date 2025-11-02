import type { Component } from "solid-js";
import { createSignal, createEffect, onCleanup } from "solid-js";
import { Trash2, FileText, Video } from "lucide-solid";

interface FilePreviewProps {
  file: File;
  onRemove: () => void;
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
    <div class="relative bg-[#2b2d31] rounded-lg overflow-hidden group">
      <button
        class="absolute top-2 right-2 z-10 p-1.5 bg-[#313338] rounded opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={props.onRemove}
        title="Remove file"
      >
        <Trash2 class="text-[#F23F42]" size={16} />
      </button>

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
            <Video class="text-[#939bf9]" size={48} />
          ) : props.file.type.includes("pdf") ? (
            <FileText class="text-[#e85d75]" size={48} />
          ) : (
            <FileText class="text-[#939bf9]" size={48} />
          )}
          <div class="mt-3 text-center w-full">
            <p class="text-sm text-[#DBDEE1] truncate">{props.file.name}</p>
            <p class="text-xs text-[#949ba4] mt-1">
              {formatFileSize(props.file.size)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilePreview;
