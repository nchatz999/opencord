import {
  createSignal,
  For,
  Show,
  mergeProps,
  createMemo,
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
  const merged = mergeProps(props);

  const [activeTab, setActiveTab] = createSignal(
    merged.defaultActiveTab || merged.items[0]?.id
  );

  const activeContent = createMemo(() => {
    return merged.items.find((item) => item.id === activeTab())?.content;
  });

  return (
    <div class={cn("flex flex-col", merged.class)}>
      <div class="flex border-b border-[#202225]">
        <For each={merged.items}>
          {(item) => (
            <button
              class={cn(
                "py-2 px-4 font-semibold",
                activeTab() === item.id
                  ? "text-white border-b-2 border-[#5865f2]"
                  : "text-[#8e9297]"
              )}
              onClick={() => setActiveTab(item.id)}
            >
              <div class="flex items-center gap-2">
                <Show when={item.icon}>{item.icon}</Show>
                {item.label}
              </div>
            </button>
          )}
        </For>
      </div>
      <div class="flex-grow">{activeContent()}</div>
    </div>
  );
};
