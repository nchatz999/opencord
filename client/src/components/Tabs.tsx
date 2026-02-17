import {
  For,
  Show,
  onMount,
  createSignal,
  type JSX,
  type Component,
} from "solid-js";
import { cn } from "../utils";

interface TabItem {
  id: string;
  label: string;
  icon?: JSX.Element;
  content: JSX.Element;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (tabId: string) => void;
  class?: string;
}

export const Tabs: Component<TabsProps> = (props) => {
  const [tabWidth, setTabWidth] = createSignal<number>();
  const tabRefs: HTMLButtonElement[] = [];

  onMount(() => {
    const maxWidth = Math.max(...tabRefs.map((ref) => ref?.offsetWidth || 0));
    if (maxWidth > 0) setTabWidth(maxWidth);
  });

  return (
    <div class={cn("flex flex-col", props.class)}>
      <div class="flex border-b border-input">
        <For each={props.items}>
          {(item, index) => (
            <button
              ref={(el) => (tabRefs[index()] = el)}
              class={cn(
                "py-2 px-4 font-semibold",
                props.value === item.id
                  ? "text-accent-primary border-b-2 border-accent-primary"
                  : "text-fg-subtle"
              )}
              style={{ width: tabWidth() ? `${tabWidth()}px` : undefined }}
              onClick={() => props.onChange(item.id)}
            >
              <div class="flex items-center justify-center gap-2">
                <Show when={item.icon}>{item.icon}</Show>
                {item.label}
              </div>
            </button>
          )}
        </For>
      </div>
      <For each={props.items}>
        {(item) => (
          <div
            class="flex-grow min-h-0 flex flex-col"
            classList={{ hidden: props.value !== item.id }}
          >
            {item.content}
          </div>
        )}
      </For>
    </div>
  );
};
