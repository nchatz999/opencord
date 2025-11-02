import {
  Show,
  mergeProps,
  createMemo,
  type Component,
  type JSX,
} from "solid-js";
import { cn } from "../utils";

interface InputProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  icon?: JSX.Element;
  multiline?: boolean;
  rows?: number;
  class?: string;
}

export const Input: Component<InputProps> = (props) => {
  const merged = mergeProps(
    {
      multiline: false,
      rows: 3,
    },
    props
  );

  const inputId = createMemo(
    () => merged.id || `input-${Math.random().toString(36).substr(2, 9)}`
  );

  const inputClasses = createMemo(() =>
    cn(
      "flex-grow w-full px-3 py-2 bg-[#202225] text-[#dcddde]",
      "focus:outline-none focus:ring-2 focus:ring-[#5865f2] focus:border-transparent",
      "placeholder-[#dcddde]",
      merged.icon && "pl-10",
      merged.error && "border border-red-500",
      merged.class
    )
  );

  const handleChange: JSX.EventHandler<
    HTMLInputElement | HTMLTextAreaElement,
    Event
  > = (e) => {
    merged.onChange(e.currentTarget.value);
  };

  return (
    <div class="flex flex-col w-full">
      <Show when={merged.label}>
        <label for={inputId()} class="mb-1 text-sm font-medium text-[#dcddde]">
          {merged.label}
        </label>
      </Show>

      <div class="relative">
        <Show when={merged.icon}>
          <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            {merged.icon}
          </div>
        </Show>

        <Show
          when={merged.multiline}
          fallback={
            <input
              id={inputId()}
              type="text"
              value={merged.value}
              placeholder={merged.placeholder}
              onChange={handleChange}
              class={inputClasses()}
            />
          }
        >
          <textarea
            id={inputId()}
            value={merged.value}
            placeholder={merged.placeholder}
            onChange={handleChange}
            class={cn(inputClasses(), "resize-none")}
            rows={merged.rows}
          />
        </Show>
      </div>

      <Show when={merged.error}>
        <p class="mt-1 text-sm text-red-500">{merged.error}</p>
      </Show>
    </div>
  );
};
