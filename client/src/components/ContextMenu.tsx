import {
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
  mergeProps,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "../utils";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  customContent?: JSX.Element;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: JSX.Element;
  disabled?: boolean;
  class?: string;
}

export default function ContextMenu(props: ContextMenuProps) {
  const merged = mergeProps({ disabled: false }, props);
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  let menuRef: HTMLDivElement | undefined;
  let triggerRef: HTMLDivElement | undefined;

  const handleContextMenu = (e: MouseEvent) => {
    if (merged.disabled) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = triggerRef?.getBoundingClientRect();
    if (rect) {
      setPosition({
        x: e.clientX,
        y: e.clientY,
      });
      setIsOpen(true);
    }
  };

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.disabled) return;
    item.onClick();
    setIsOpen(false);
  };

  const stopEvents = (e: Event) => {
    e.stopPropagation();
  };

  createEffect(() => {
    if (isOpen()) {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef && !menuRef.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };
      const handleScroll = () => {
        setIsOpen(false);
      };

      // Use setTimeout to avoid the immediate trigger
      setTimeout(() => {
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("pointerdown", handleClickOutside as EventListener);
        document.addEventListener("scroll", handleScroll, true);
        document.addEventListener("contextmenu", handleClickOutside);
      }, 0);

      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("pointerdown", handleClickOutside as EventListener);
        document.removeEventListener("scroll", handleScroll, true);
        document.removeEventListener("contextmenu", handleClickOutside);
      });
    }
  });

  createEffect(() => {
    if (isOpen() && menuRef) {
      const menuRect = menuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const pos = position();

      let adjustedX = pos.x;
      let adjustedY = pos.y;

      if (pos.x + menuRect.width > viewportWidth) {
        adjustedX = viewportWidth - menuRect.width - 8;
      }

      if (pos.y + menuRect.height > viewportHeight) {
        adjustedY = viewportHeight - menuRect.height - 8;
      }

      adjustedX = Math.max(8, adjustedX);
      adjustedY = Math.max(8, adjustedY);

      if (adjustedX !== pos.x || adjustedY !== pos.y) {
        setPosition({ x: adjustedX, y: adjustedY });
      }
    }
  });

  return (
    <>
      <div
        ref={(el) => { triggerRef = el; }}
        onContextMenu={handleContextMenu}
        class={cn("cursor-pointer", merged.class)}
      >
        {merged.children}
      </div>

      <Show when={isOpen()}>
        <Portal>
          <div
            ref={(el) => { menuRef = el; }}
            class="fixed z-50 min-w-[180px] bg-context-menu rounded-md shadow-lg border border-border-subtle py-1"
            style={{
              left: `${position().x}px`,
              top: `${position().y}px`,
            }}
          >
            <For each={merged.items}>
              {(item) => (
                <Show
                  when={!item.separator}
                  fallback={<div class="h-px bg-bg-subtle my-1 mx-2" />}
                >
                  <Show
                    when={!item.customContent}
                    fallback={
                      <div
                        class="px-3 py-2"
                        ref={(el) => {
                          // Use native event listeners for reliable propagation stopping
                          el.addEventListener('mousedown', stopEvents);
                          el.addEventListener('pointerdown', stopEvents);
                          el.addEventListener('click', stopEvents);
                        }}
                      >
                        {item.customContent}
                      </div>
                    }
                  >
                    <button
                      onClick={() => handleItemClick(item)}
                      disabled={item.disabled}
                      class={cn(
                        "w-full px-3 py-2 text-sm text-left flex items-center gap-3 transition-colors",
                        "hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none",
                        item.danger
                          ? "text-status-danger hover:text-status-danger"
                          : "text-fg-base hover:text-fg-emphasis",
                        item.disabled &&
                        "opacity-50 cursor-not-allowed hover:bg-transparent"
                      )}
                    >
                      <Show when={item.icon}>
                        <span class="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                          {item.icon}
                        </span>
                      </Show>
                      <span class="flex-1 truncate">{item.label}</span>
                    </button>
                  </Show>
                </Show>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
