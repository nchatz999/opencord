import {
  createSignal,
  createEffect,
  onCleanup,
  createContext,
  useContext,
  For,
  Show,
  mergeProps,
  type JSX,
  type Component,
} from "solid-js";
import { Portal } from "solid-js/web";
import { ChevronRight } from "lucide-solid";
import { cn } from "../utils";


type ContextMenuItemProps = {
  type: "item";
  label: string;
  onClick?: () => void;
  icon?: JSX.Element;
  disabled?: boolean;
  danger?: boolean;
  keepOpen?: boolean;
  subMenu?: ContextMenuProps[];
};

type ContextMenuSeperatorProps = {
  type: "separator";
};

export type ContextMenuProps = ContextMenuItemProps | ContextMenuSeperatorProps;


type ContextMenuContextType = {
  showContextMenu: (e: MouseEvent, items: ContextMenuProps[]) => void;
  hideContextMenu: () => void;
};

const ContextMenuContext = createContext<ContextMenuContextType>();


export const ContextMenuProvider: Component<{ children: JSX.Element }> = (
  props
) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [menuItems, setMenuItems] = createSignal<ContextMenuProps[]>([]);
  let menuRef: HTMLDivElement | undefined;

  const showContextMenu = (e: MouseEvent, items: ContextMenuProps[]) => {
    e.preventDefault();
    setIsOpen(true);
    setPosition({ x: e.clientX, y: e.clientY });
    setMenuItems(items);
  };

  const hideContextMenu = () => {
    setIsOpen(false);
  };

  
  createEffect(() => {
    if (isOpen()) {
      const handleClickOutside = (e: MouseEvent) => {
        if (menuRef && !menuRef.contains(e.target as Node)) {
          hideContextMenu();
        }
      };

      const handleEscapeKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          hideContextMenu();
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscapeKey);

      onCleanup(() => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscapeKey);
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
        adjustedX = viewportWidth - menuRect.width - 10;
      }

      if (pos.y + menuRect.height > viewportHeight) {
        adjustedY = viewportHeight - menuRect.height - 10;
      }

      if (adjustedX !== pos.x || adjustedY !== pos.y) {
        setPosition({ x: adjustedX, y: adjustedY });
      }
    }
  });

  return (
    <ContextMenuContext.Provider value={{ showContextMenu, hideContextMenu }}>
      {props.children}
      <Show when={isOpen()}>
        <Portal>
          <div
            ref={menuRef}
            class="fixed z-50 min-w-[180px] bg-context-menu shadow-lg text-foreground border border-input"
            style={{ left: `${position().x}px`, top: `${position().y}px` }}
          >
            <For each={menuItems()}>
              {(item) => (
                <Show
                  when={item.type === "item"}
                  fallback={<ContextMenuSeparator />}
                >
                  <ContextMenuItem
                    {...(item as ContextMenuItemProps)}
                    onClick={() => {
                      const itemProps = item as ContextMenuItemProps;
                      if (itemProps.onClick) {
                        itemProps.onClick();
                      }
                      if (!itemProps.keepOpen) {
                        hideContextMenu();
                      }
                    }}
                  />
                </Show>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </ContextMenuContext.Provider>
  );
};


export const useContextMenu = () => {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return context;
};


export const ContextMenuItem: Component<ContextMenuItemProps> = (props) => {
  const merged = mergeProps({ disabled: false, danger: false }, props);
  const [isSubMenuVisible, setIsSubMenuVisible] = createSignal(false);
  let itemRef: HTMLDivElement | undefined;
  let subMenuRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (merged.subMenu && merged.subMenu.length > 0) {
      const handleMouseEnter = () => setIsSubMenuVisible(true);
      const handleMouseLeave = () => setIsSubMenuVisible(false);

      if (itemRef) {
        itemRef.addEventListener("mouseenter", handleMouseEnter);
        itemRef.addEventListener("mouseleave", handleMouseLeave);

        onCleanup(() => {
          itemRef?.removeEventListener("mouseenter", handleMouseEnter);
          itemRef?.removeEventListener("mouseleave", handleMouseLeave);
        });
      }
    }
  });

  createEffect(() => {
    if (isSubMenuVisible() && itemRef && subMenuRef) {
      const itemRect = itemRef.getBoundingClientRect();
      const subMenuRect = subMenuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let leftPosition = itemRect.right;
      let topPosition = itemRect.top;

      if (leftPosition + subMenuRect.width > viewportWidth) {
        leftPosition = itemRect.left - subMenuRect.width;
      }

      if (topPosition + subMenuRect.height > viewportHeight) {
        topPosition = viewportHeight - subMenuRect.height - 10;
      }

      subMenuRef.style.left = `${leftPosition}px`;
      subMenuRef.style.top = `${topPosition}px`;
    }
  });

  return (
    <div
      ref={itemRef}
      class={cn(
        "px-3 py-2 flex items-center text-sm cursor-pointer relative",
        merged.disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-primary-hover hover:text-primary-foreground",
        merged.danger &&
        !merged.disabled &&
        "text-destructive hover:text-primary-foreground hover:bg-destructive"
      )}
      onClick={!merged.disabled ? merged.onClick : undefined}
    >
      <Show when={merged.icon}>
        <span class="mr-2">{merged.icon}</span>
      </Show>
      <span class="flex-grow">{merged.label}</span>
      <Show when={merged.subMenu && merged.subMenu.length > 0}>
        <ChevronRight class="w-4 h-4 ml-2" />
      </Show>

      <Show
        when={isSubMenuVisible() && merged.subMenu && merged.subMenu.length > 0}
      >
        <div
          ref={subMenuRef}
          class="fixed z-50 min-w-[180px] bg-context-menu shadow-lg text-foreground border border-input"
        >
          <For each={merged.subMenu}>
            {(item) => (
              <Show
                when={item.type === "item"}
                fallback={<ContextMenuSeparator />}
              >
                <ContextMenuItem {...(item as ContextMenuItemProps)} />
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};


export const ContextMenuSeparator: Component = () => {
  return <div class="h-px bg-card my-1" />;
};


interface WithContextMenuProps {
  children: JSX.Element;
  menuItems: ContextMenuProps[];
  disabled?: boolean;
  class?: string;
}

export const WithContextMenu: Component<WithContextMenuProps> = (props) => {
  const merged = mergeProps({ disabled: false }, props);
  const { showContextMenu } = useContextMenu();

  const handleContextMenu = (e: MouseEvent) => {
    if (!merged.disabled) {
      showContextMenu(e, merged.menuItems);
    }
  };

  return (
    <div onContextMenu={handleContextMenu} class={merged.class}>
      {merged.children}
    </div>
  );
};
