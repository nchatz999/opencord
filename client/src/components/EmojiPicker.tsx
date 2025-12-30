import { createSignal, createMemo, For, Show, onMount, onCleanup, type Component, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Smile } from "lucide-solid";
import { cn } from "../utils";
import Button from "./Button";

const EMOJI_CATEGORIES = {
  "Smileys": ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐"],
  "Gestures": ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💪", "🦾", "🦿"],
  "People": ["👶", "👧", "🧒", "👦", "👩", "🧑", "👨", "👩‍🦱", "🧑‍🦱", "👨‍🦱", "👩‍🦰", "🧑‍🦰", "👨‍🦰", "👱‍♀️", "👱", "👱‍♂️", "👩‍🦳", "🧑‍🦳", "👨‍🦳", "👩‍🦲", "🧑‍🦲", "👨‍🦲", "🧔‍♀️", "🧔", "🧔‍♂️", "👵", "🧓", "👴", "👲", "👳‍♀️", "👳", "👳‍♂️", "🧕", "👮‍♀️", "👮", "👮‍♂️"],
  "Hearts": ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️", "💋", "💌", "💐", "🌹", "🥀", "🌷", "🌸", "💮", "🏵️", "🌻", "🌼"],
  "Animals": ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞"],
  "Food": ["🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟", "🍕"],
  "Activities": ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🏑", "🥍", "🏏", "🪃", "🥅", "⛳", "🪁", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "🤺", "⛹️", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚴", "🚵", "🎪", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🪘", "🎷", "🎺", "🪗", "🎸", "🪕", "🎻"],
  "Objects": ["⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "💽", "💾", "💿", "📀", "📷", "📹", "🎥", "📞", "📺", "📻", "🎙️", "⏰", "⌛", "⏳", "📡", "🔋", "🔌", "💡", "🔦", "💸", "💵", "💰", "💳", "💎", "🧰", "🔧", "🔨", "🔩", "⚙️", "🔫", "💣", "🔪", "🗡️", "⚔️", "🛡️", "🔮", "💊", "💉"],
  "Symbols": ["❤️", "💯", "💢", "💥", "💫", "💦", "💨", "💬", "💭", "💤", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪", "🔶", "🔷", "🔸", "🔹", "✅", "❌", "❎", "➕", "➖", "➗", "✖️", "♾️", "💲", "™️", "©️", "®️", "✔️", "☑️", "🔃", "🔄"],
} as const;

type CategoryName = keyof typeof EMOJI_CATEGORIES;

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  class?: string;
  icon?: JSX.Element;
  size?: "sm" | "md" | "lg";
}

const EmojiPicker: Component<EmojiPickerProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [position, setPosition] = createSignal({ top: 0, left: 0 });
  let buttonRef: HTMLButtonElement | undefined;
  let dropdownRef: HTMLDivElement | undefined;

  const categoryNames = Object.keys(EMOJI_CATEGORIES) as CategoryName[];

  const filteredCategories = createMemo(() => {
    const query = search().toLowerCase();
    if (!query) {
      return EMOJI_CATEGORIES;
    }

    const results: Record<string, readonly string[]> = {};
    for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
      if (category.toLowerCase().includes(query)) {
        results[category] = emojis;
      }
    }
    return results;
  });

  const updatePosition = () => {
    if (!buttonRef) return;

    const rect = buttonRef.getBoundingClientRect();
    const dropdownWidth = 320;
    const dropdownHeight = 340;

    let left = rect.right - dropdownWidth;
    let top = rect.top - dropdownHeight - 8;

    if (left < 8) left = 8;
    if (top < 8) {
      top = rect.bottom + 8;
    }

    setPosition({ top, left });
  };

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (buttonRef?.contains(target)) return;
    if (dropdownRef?.contains(target)) return;
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (!isOpen()) {
      updatePosition();
    }
    setIsOpen(!isOpen());
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const handleSelect = (emoji: string) => {
    props.onSelect(emoji);
    setIsOpen(false);
  };

  return (
    <div class={cn("relative", props.class)}>
      <Button
        ref={buttonRef}
        variant="ghost"
        size={props.size}
        title="Add reaction"
        onClick={handleToggle}
      >
        {props.icon || <Smile size={20} />}
      </Button>

      <Show when={isOpen()}>
        <Portal>
          <div
            ref={dropdownRef}
            class="fixed w-80 bg-popover rounded-lg border border-border shadow-lg overflow-hidden z-[9999]"
            style={{ top: `${position().top}px`, left: `${position().left}px` }}
          >
            <div class="p-2 border-b border-border">
              <input
                type="text"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                placeholder="Search emojis..."
                class="w-full px-3 py-2 bg-input text-foreground text-sm rounded focus:outline-none focus:ring-2 focus:ring-ring placeholder-muted-foreground-dark"
              />
            </div>

            <div class="h-72 overflow-y-auto p-2">
              <For each={categoryNames}>
                {(category) => (
                  <Show when={filteredCategories()[category]?.length > 0}>
                    <div class="mb-3">
                      <h3 class="text-xs font-medium text-muted-foreground mb-2 bg-popover py-1">
                        {category}
                      </h3>
                      <div class="grid grid-cols-8 gap-1">
                        <For each={filteredCategories()[category]}>
                          {(emoji) => (
                            <button
                              onClick={() => handleSelect(emoji)}
                              class="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-muted transition-colors"
                            >
                              {emoji}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

export default EmojiPicker;
