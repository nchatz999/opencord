import {
  createSignal,
  For,
  Show,
  onMount,
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
  defaultActiveTab?: string;
  class?: string;
}

export const Tabs: Component<TabsProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal(
    props.defaultActiveTab || props.items[0]?.id
  );
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
                activeTab() === item.id
                  ? "text-accent-primary border-b-2 border-accent-primary"
                  : "text-fg-subtle"
              )}
              style={{ width: tabWidth() ? `${tabWidth()}px` : undefined }}
              onClick={() => setActiveTab(item.id)}
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
            class="flex-grow"
            classList={{ hidden: activeTab() !== item.id }}
          >
            {item.content}
          </div>
        )}
      </For>
    </div>
  );
};
