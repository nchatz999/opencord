import {
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js";
import { ChevronDown } from "lucide-solid";
import { cn } from "../utils";

export interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string | number | undefined;
  onChange: (value: string | number) => void;
  placeholder?: string;
  label?: string;
  class?: string;
  dropdownClass?: string;
  zIndex?: number;
  position?: "absolute" | "fixed";
  maxHeight?: string;
}

export default function Select(props: SelectProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [dropdownPosition, setDropdownPosition] = createSignal({
    top: 0,
    left: 0,
    width: 0,
  });
  let selectRef: HTMLDivElement | undefined;
  let dropdownRef: HTMLDivElement | undefined;

  const selectedLabel = createMemo(() => {
    if (props.value === undefined) {
      return props.placeholder || "Select an option";
    }
    const option = props.options.find((option) => option.value === props.value);
    return option?.label || props.placeholder || "Select an option";
  });

  const handleSelect = (value: string | number) => {
    props.onChange(value);
    setIsOpen(false);
  };

  const updateDropdownPosition = () => {
    if (selectRef && isOpen()) {
      const rect = selectRef.getBoundingClientRect();
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft =
        window.pageXOffset || document.documentElement.scrollLeft;

      if (props.position === "fixed") {
        setDropdownPosition({
          top: rect.bottom,
          left: rect.left,
          width: rect.width,
        });
      } else {
        setDropdownPosition({
          top: rect.bottom + scrollTop,
          left: rect.left + scrollLeft,
          width: rect.width,
        });
      }
    }
  };

  createEffect(() => {
    if (isOpen()) {
      updateDropdownPosition();

      const handleClickOutside = (event: MouseEvent) => {
        if (
          selectRef &&
          dropdownRef &&
          !selectRef.contains(event.target as Node) &&
          !dropdownRef.contains(event.target as Node)
        ) {
          setIsOpen(false);
        }
      };

      const handleScroll = () => {
        if (props.position !== "fixed") {
          updateDropdownPosition();
        }
      };

      const handleResize = () => {
        updateDropdownPosition();
      };

      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleResize);

      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleResize);
      });
    }
  });

  return (
    <>
      <div class={cn("relative", props.class)} ref={selectRef}>
        <Show when={props.label}>
          <label class="block mb-2 text-sm font-medium text-foreground">
            {props.label}
          </label>
        </Show>
        <div
          class={cn(
            "flex items-center justify-between px-2 gap-2 py-2 bg-input text-foreground cursor-pointer",
            isOpen() ? "ring-2 ring-ring focus:border-transparent" : ""
          )}
          onClick={() => {
            if (props.options.length > 0) {
              setIsOpen(!isOpen());
            }
          }}
          role="button"
          tabindex="0"
          aria-haspopup="listbox"
          aria-expanded={isOpen()}
        >
          <span>{selectedLabel()}</span>
          <ChevronDown
            class={cn(
              "w-4 h-4 transition-transform",
              isOpen() && "transform rotate-180"
            )}
          />
        </div>
      </div>

      <Show when={isOpen()}>
        <div
          ref={dropdownRef}
          class={cn("bg-input shadow-lg", props.dropdownClass)}
          style={{
            position: props.position || "absolute",
            "z-index": props.zIndex || 9999,
            top: `${dropdownPosition().top}px`,
            left: `${dropdownPosition().left}px`,
            width: `${dropdownPosition().width}px`,
            "max-height": props.maxHeight || "300px",
            "overflow-y": "auto",
          }}
          role="listbox"
        >
          {" "}
          <For each={props.options}>
            {(option) => (
              <div
                class="px-3 py-2 text-foreground cursor-pointer hover:bg-primary-hover hover:text-primary-foreground transition-colors"
                onClick={() => handleSelect(option.value)}
                role="option"
                aria-selected={props.value === option.value}
              >
                {option.label}
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}


