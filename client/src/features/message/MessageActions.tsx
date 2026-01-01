import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Edit2Icon, ReplyIcon, Trash2Icon, CopyIcon, SmilePlus } from "lucide-solid";
import type { Message } from "../../model";
import Button from "../../components/Button";
import EmojiPicker from "../../components/EmojiPicker";
import { ownerFlex } from "./MessageBubble";

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

export default MessageActions;
