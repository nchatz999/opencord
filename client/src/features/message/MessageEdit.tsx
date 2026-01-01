import type { Component } from "solid-js";
import TextEditor from "../../components/TextEditor";
import Button from "../../components/Button";
import { formatLinks } from "../../utils/messageFormatting";

interface MessageEditProps {
  content: string;
  onInput: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

const MessageEdit: Component<MessageEditProps> = (props) => (
  <div class="flex flex-col gap-2">
    <TextEditor
      value={props.content}
      onInput={props.onInput}
      format={(text) => formatLinks(text, "text-link hover:underline")}
      maxHeight={600}
      class="min-w-48 max-w-2xl"
    />
    <div class="flex gap-2 mt-2">
      <Button size="sm" variant="primary" onClick={props.onSave}>Save</Button>
      <Button size="sm" variant="secondary" onClick={props.onCancel}>Cancel</Button>
    </div>
  </div>
);

export default MessageEdit;
