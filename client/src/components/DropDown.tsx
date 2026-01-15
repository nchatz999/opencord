import {
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
  mergeProps,
  createMemo,
  type JSX,
  type Component,
} from "solid-js";
import { Check, ChevronDown } from "lucide-solid";
import { cn } from "../utils";

export interface DropDownOption {
  value: string;
  label: string;
  description?: string;
  icon?: JSX.Element;
}

interface DropDownProps {
  options: DropDownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  maxHeight?: number;
  width?: number | string;
  position?: "bottom" | "top";
}

export const DropDown: Component<DropDownProps> = (props) => {
  const merged = mergeProps(
    {
      placeholder: "Select an option",
      disabled: false,
      maxHeight: 300,
      width: "100%",
      position: "bottom" as const,
    },
    props
  );

  const [isOpen, setIsOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  const selectedOption = createMemo(() =>
    merged.options.find((option) => option.value === merged.value)
  );

  const handleSelect = (optionValue: string) => {
    merged.onChange(optionValue);
    setIsOpen(false);
  };

  createEffect(() => {
    if (isOpen()) {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);

      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
      });
    }
  });

  return (
    <div
      class={cn("relative", merged.class)}
      ref={dropdownRef}
      style={{
        width:
          typeof merged.width === "number" ? `${merged.width}px` : merged.width,
      }}
    >
      <button
        type="button"
        class={cn(
          "flex items-center justify-between w-full px-3 py-2 text-sm font-medium",
          "bg-bg-elevated text-fg-base rounded-md transition-colors",
          "hover:bg-bg-overlay",
          isOpen() && "ring-2 ring-focus-ring",
          merged.disabled && "opacity-50 cursor-not-allowed",
          "focus:outline-none"
        )}
        onClick={() => !merged.disabled && setIsOpen(!isOpen())}
        disabled={merged.disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
      >
        <div class="flex items-center gap-2 truncate">
          <Show when={selectedOption()?.icon}>
            <span class="flex-shrink-0">{selectedOption()!.icon}</span>
          </Show>
          <span class="truncate">
            {selectedOption() ? selectedOption()!.label : merged.placeholder}
          </span>
        </div>
        <ChevronDown
          class={cn(
            "w-4 h-4 ml-2 transition-transform duration-200",
            isOpen() && "transform rotate-180"
          )}
        />
      </button>

      <Show when={isOpen()}>
        <div
          class={cn(
            "absolute z-500 w-full mt-1 overflow-auto bg-bg-overlay rounded-md shadow-lg",
            "border border-input",
            merged.position === "top" ? "bottom-full mb-1" : "top-full mt-1"
          )}
          style={{ "max-height": `${merged.maxHeight}px` }}
          role="listbox"
        >
          <For each={merged.options}>
            {(option) => {
              const isSelected = () => option.value === merged.value;

              return (
                <div
                  class={cn(
                    "flex items-center px-3 py-2 cursor-pointer",
                    "hover:bg-accent-secondary transition-colors",
                    isSelected() && "bg-accent-secondary"
                  )}
                  onClick={() => handleSelect(option.value)}
                  role="option"
                  aria-selected={isSelected()}
                >
                  <div class="flex-grow flex items-center gap-2">
                    <Show when={option.icon}>
                      <span class="flex-shrink-0">{option.icon}</span>
                    </Show>
                    <div class="flex flex-col">
                      <span class="text-fg-base font-medium">
                        {option.label}
                      </span>
                      <Show when={option.description}>
                        <span class="text-xs text-fg-subtle">
                          {option.description}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <Show when={isSelected()}>
                    <Check class="w-4 h-4 text-accent-primary ml-2" />
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
