import {
  Show,
  mergeProps,
  splitProps,
  createMemo,
  type Component,
  type JSX,
} from "solid-js";
import { cn } from "../utils";

interface InputProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  label?: string;
  error?: string;
  icon?: JSX.Element;
  multiline?: boolean;
  rows?: number;
  class?: string;
}

export const Input: Component<InputProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "value",
    "placeholder",
    "onChange",
    "label",
    "error",
    "icon",
    "multiline",
    "rows",
    "class",
    "type",
    "id",
  ]);

  const merged = mergeProps(
    {
      multiline: false,
      rows: 3,
    },
    local
  );

  const inputId = createMemo(
    () => merged.id || `input-${Math.random().toString(36).substr(2, 9)}`
  );

  const inputClasses = createMemo(() =>
    cn(
      "flex-grow w-full px-3 py-2 bg-input text-fg-base",
      "focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent",
      "placeholder:text-fg-muted",
      merged.icon && "pl-10",
      merged.error && "border border-status-danger",
      merged.class
    )
  );

  const handleChange: JSX.EventHandler<
    HTMLInputElement | HTMLTextAreaElement,
    Event
  > = (e) => {
    merged.onChange?.(e.currentTarget.value);
  };

  return (
    <div class="flex flex-col w-full">
      <Show when={merged.label}>
        <label for={inputId()} class="mb-1 text-sm font-medium text-fg-base">
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
              {...rest}
              id={inputId()}
              type={merged.type || "text"}
              value={merged.value}
              placeholder={merged.placeholder}
              onInput={handleChange}
              class={inputClasses()}
            />
          }
        >
          <textarea
            {...rest}
            id={inputId()}
            value={merged.value}
            placeholder={merged.placeholder}
            onInput={handleChange}
            class={cn(inputClasses(), "resize-none")}
            rows={merged.rows}
          />
        </Show>
      </div>

      <Show when={merged.error}>
        <p class="mt-1 text-sm text-status-danger">{merged.error}</p>
      </Show>
    </div>
  );
};
