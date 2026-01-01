import type { Component } from "solid-js";
import { For } from "solid-js";
import { formatMessageText } from "../../utils/messageFormatting";
import YouTubeEmbed from "./YouTubeEmbed";

interface MessageContentProps {
  text: string;
  isOwner: boolean;
  type: "direct" | "channel";
  youtubeIds: string[];
}

const MessageContent: Component<MessageContentProps> = (props) => (
  <>
    <span class="text-foreground font-normal break-words whitespace-pre-wrap">
      {formatMessageText(props.text, props.isOwner, props.type)}
    </span>
    <For each={props.youtubeIds}>{(id) => <YouTubeEmbed id={id} />}</For>
  </>
);

export default MessageContent;
