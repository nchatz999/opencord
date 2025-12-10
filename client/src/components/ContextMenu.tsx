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


  createEffect(() => {
    if (isOpen()) {
      const handleClickOutside = (event: MouseEvent) => {
        if (menuRef) {
          const rect = menuRef.getBoundingClientRect();
          const x = event.clientX;
          const y = event.clientY;

          const isOutside = (
            x < rect.left ||
            x > rect.right ||
            y < rect.top ||
            y > rect.bottom
          );

          if (isOutside) {
            setIsOpen(false);
          }
        }
      };
      const handleScroll = () => {
        setIsOpen(false);
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("scroll", handleScroll, true);
      document.addEventListener("contextmenu", handleClickOutside);

      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
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
        ref={triggerRef}
        onContextMenu={handleContextMenu}
        class={cn("cursor-pointer", merged.class)}
      >
        {merged.children}
      </div>

      <Show when={isOpen()}>
        <Portal>
          <>
            <div
              ref={menuRef}
              class="fixed z-50 min-w-[180px] bg-context-menu rounded-md shadow-lg border border-border-subtle py-1"
              style={{
                left: `${position().x}px`,
                top: `${position().y}px`,
              }}
            >
              <For each={merged.items}>
                {(item, index) => (
                  <Show
                    when={!item.separator}
                    fallback={<div class="h-px bg-border-subtle my-1 mx-2" />}
                  >
                    <Show
                      when={!item.customContent}

                      fallback={
                        <div class="px-3 py-2"

                        >{item.customContent}</div>
                      }
                    >
                      <button
                        onClick={() => handleItemClick(item)}
                        disabled={item.disabled}
                        class={cn(
                          "w-full px-3 py-2 text-sm text-left flex items-center gap-3 transition-colors",
                          "hover:bg-muted focus:bg-muted focus:outline-none",
                          item.danger
                            ? "text-destructive hover:text-destructive"
                            : "text-foreground hover:text-primary-foreground",
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
          </>
        </Portal>
      </Show>
    </>
  );
}
