import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { state } from "../store";

interface DebugItemProps {
  label: string;
  value: any;
  depth?: number;
}

const DebugItem: Component<DebugItemProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const depth = () => props.depth || 0;
  const indent = () => depth() * 16;

  const getValueType = (val: any): string => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (Array.isArray(val)) return "array";
    if (val instanceof Date) return "date";
    if (typeof val === "object") return "object";
    return typeof val;
  };

  const formatPrimitiveValue = (val: any): string => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val === "string") return `"${val}"`;
    if (typeof val === "boolean") return val.toString();
    if (typeof val === "number") return val.toString();
    if (val instanceof Date) return val.toISOString();
    return String(val);
  };

  const getTypeColor = (type: string): string => {
    switch (type) {
      case "string": return "text-green-400";
      case "number": return "text-blue-400";
      case "boolean": return "text-purple-400";
      case "null": return "text-gray-400";
      case "undefined": return "text-gray-400";
      case "date": return "text-yellow-400";
      case "array": return "text-orange-400";
      case "object": return "text-cyan-400";
      default: return "text-white";
    }
  };

  const isPrimitive = (val: any): boolean => {
    const type = getValueType(val);
    return !["array", "object"].includes(type);
  };

  const getObjectEntries = (obj: any): [string, any][] => {
    if (Array.isArray(obj)) {
      return obj.map((item, index) => [index.toString(), item]);
    }
    return Object.entries(obj);
  };

  const getCollectionLength = (val: any): number => {
    if (Array.isArray(val)) return val.length;
    if (typeof val === "object" && val !== null) return Object.keys(val).length;
    return 0;
  };

  return (
    <div class="text-sm font-mono" style={{ "margin-left": `${indent()}px` }}>
      <div class="flex items-center gap-2 py-1">
        <Show when={!isPrimitive(props.value)}>
          <button
            onClick={() => setIsExpanded(!isExpanded())}
            class="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            {isExpanded() ? "▼" : "▶"}
          </button>
        </Show>
        <Show when={isPrimitive(props.value)}>
          <div class="w-4" />
        </Show>
        
        <span class="text-gray-300">{props.label}:</span>
        
        <Show when={isPrimitive(props.value)}>
          <span class={getTypeColor(getValueType(props.value))}>
            {formatPrimitiveValue(props.value)}
          </span>
        </Show>
        
        <Show when={!isPrimitive(props.value)}>
          <span class={getTypeColor(getValueType(props.value))}>
            {getValueType(props.value)}
            <span class="text-gray-400 ml-1">
              ({getCollectionLength(props.value)} items)
            </span>
          </span>
        </Show>
      </div>
      
      <Show when={!isPrimitive(props.value) && isExpanded()}>
        <div class="border-l border-gray-600 ml-2">
          <For each={getObjectEntries(props.value)}>
            {([key, value]) => (
              <DebugItem 
                label={key} 
                value={value} 
                depth={depth() + 1}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

const DebugOverlay: Component = () => {
  const [isVisible, setIsVisible] = createSignal(false);
  const [selectedSection, setSelectedSection] = createSignal<string>("all");

  const sections = [
    { key: "all", label: "All State" },
    { key: "appState", label: "App State" },
    { key: "users", label: "Users" },
    { key: "groups", label: "Groups" },
    { key: "channels", label: "Channels" },
    { key: "messages", label: "Messages" },
    { key: "voipState", label: "VoIP State" },
    { key: "roles", label: "Roles" },
    { key: "files", label: "Files" },
  ];

  const getStateSection = () => {
    const section = selectedSection();
    if (section === "all") return state;
    return { [section]: (state as any)[section] };
  };

  return (
    <>
      <div class="fixed top-4 right-4 z-[9999]">
        <button
          onClick={() => setIsVisible(!isVisible())}
          class="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Debug {isVisible() ? "Hide" : "Show"}
        </button>
      </div>

      <Show when={isVisible()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 z-[9998]" onClick={() => setIsVisible(false)} />
        <div class="fixed top-4 left-4 right-4 bottom-4 bg-[#1e1f22] border border-gray-600 rounded-lg z-[9999] flex flex-col">
          <div class="flex items-center justify-between p-4 border-b border-gray-600">
            <h2 class="text-lg font-semibold text-white">Debug State Viewer</h2>
            <div class="flex items-center gap-4">
              <select
                value={selectedSection()}
                onChange={(e) => setSelectedSection(e.target.value)}
                class="bg-[#2b2d31] text-white px-3 py-1 rounded border border-gray-600 text-sm"
              >
                <For each={sections}>
                  {(section) => (
                    <option value={section.key}>{section.label}</option>
                  )}
                </For>
              </select>
              <button
                onClick={() => setIsVisible(false)}
                class="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
          
          <div class="flex-1 overflow-auto p-4 bg-[#313338]">
            <DebugItem label="state" value={getStateSection()} />
          </div>
        </div>
      </Show>
    </>
  );
};

export default DebugOverlay;
