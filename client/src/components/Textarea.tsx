import {
  mergeProps,
  createMemo,
  Show,
  type JSX,
  type Component,
} from "solid-js";
import { cn } from "../utils";

interface TextareaProps
  extends Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  rows?: number;
  class?: string;
}

export const Textarea: Component<TextareaProps> = (props) => {
  const merged = mergeProps({ rows: 3 }, props);

  const textareaId = createMemo(
    () => merged.id || `textarea-${Math.random().toString(36)}`
  );

  const textareaClasses = createMemo(() =>
    cn(
      "flex-grow w-full px-3 py-2 bg-[#40444b] text-[#dcddde]",
      "focus:outline-none focus:ring-2 focus:ring-[#5865f2] focus:border-transparent",
      "placeholder-[#72767d]",
      "resize-none",
      "scrollbar scrollbar-thumb-[#202225] scrollbar-track-[#2f3136] scrollbar-thin",
      merged.error && "border border-red-500",
      merged.class
    )
  );

  const handleChange: JSX.EventHandler<HTMLTextAreaElement, Event> = (e) => {
    merged.onChange(e.currentTarget.value);
  };

  return (
    <div class="flex flex-col w-full">
      <Show when={merged.label}>
        <label
          for={textareaId()}
          class="mb-1 text-sm font-medium text-[#dcddde]"
        >
          {merged.label}
        </label>
      </Show>

      <div class="relative">
        <textarea
          id={textareaId()}
          value={merged.value}
          onInput={handleChange}
          class={textareaClasses()}
          rows={merged.rows}
          style={{ "min-height": "44px", "max-height": "50vh" }}
        />
      </div>

      <Show when={merged.error}>
        <p class="mt-1 text-sm text-[#f04747]">{merged.error}</p>
      </Show>
    </div>
  );
};
