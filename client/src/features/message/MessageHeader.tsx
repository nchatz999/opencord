import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { Message, User } from "../../model";
import { ownerFlex } from "./MessageBubble";

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

export default MessageHeader;
