import { mergeProps, Show, type Component, type JSX } from "solid-js";
import { Check } from "lucide-solid";
import { cn } from "../utils";

interface CheckboxProps
  extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  class?: string;
  disabled?: boolean;
}

export const Checkbox: Component<CheckboxProps> = (props) => {
  const merged = mergeProps({ disabled: false }, props);

  const handleChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
    if (!merged.disabled) {
      merged.onChange(e.currentTarget.checked);
    }
  };

  return (
    <label
      class={cn(
        "flex items-center select-none flex-grow",
        merged.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        merged.class
      )}
    >
      <input
        type="checkbox"
        class="sr-only peer"
        checked={merged.checked}
        onChange={handleChange}
        disabled={merged.disabled}
      />
      <span
        class={cn(
          "w-5 h-5 flex items-center justify-center",
          merged.checked ? "bg-primary" : "bg-input",
          merged.disabled && "opacity-50"
        )}
      >
        <Show when={merged.checked}>
          <Check class="w-4 h-4 text-primary-foreground" />
        </Show>
      </span>
      <Show when={merged.label}>
        <span
          class={cn(
            "ml-2 text-sm font-medium text-foreground",
            merged.disabled && "opacity-50"
          )}
        >
          {merged.label}
        </span>
      </Show>
    </label>
  );
};

export default Checkbox;
