import type { Component } from "solid-js";
import { Paperclip } from "lucide-solid";

interface MessageProps {
  author: string;
  content: string;
  files: File[];
}

const Reply: Component<MessageProps> = (props) => {
  const hasAttachments = () => props.files && props.files.length > 0;

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  return (
    <div class="flex items-center mb-1 bg-accent rounded p-2 text-sm">
      <div class="w-1 h-full bg-secondary mr-2"></div>
      <div class="flex flex-col flex-grow overflow-hidden">
        <div class="flex items-center">
          <span class="font-medium text-link mr-2">{props.author}</span>
          {hasAttachments() && <Paperclip class="w-4 h-4 text-secondary-text" />}
        </div>
        {props.content && (
          <span class="text-secondary-text whitespace-nowrap overflow-hidden text-ellipsis">
            {truncateText(props.content, 100)}
          </span>
        )}
        {!props.content && hasAttachments() && (
          <span class="text-secondary-text italic">Attachment</span>
        )}
      </div>
    </div>
  );
};

export default Reply;
