import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";

export interface EventLogEntry {
  id: number;
  timestamp: string;
  type: string;
  data: unknown;
}

const eventLog: EventLogEntry[] = [];


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
      case "string": return "text-syntax-string";
      case "number": return "text-syntax-number";
      case "boolean": return "text-syntax-boolean";
      case "null": return "text-syntax-null";
      case "undefined": return "text-syntax-null";
      case "date": return "text-syntax-date";
      case "array": return "text-link";
      case "object": return "text-link";
      default: return "text-primary-foreground";
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
            class="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-primary-foreground transition-colors"
          >
            {isExpanded() ? "▼" : "▶"}
          </button>
        </Show>
        <Show when={isPrimitive(props.value)}>
          <div class="w-4" />
        </Show>

        <span class="text-muted-foreground">{props.label}:</span>

        <Show when={isPrimitive(props.value)}>
          <span class={getTypeColor(getValueType(props.value))}>
            {formatPrimitiveValue(props.value)}
          </span>
        </Show>

        <Show when={!isPrimitive(props.value)}>
          <span class={getTypeColor(getValueType(props.value))}>
            {getValueType(props.value)}
            <span class="text-muted-foreground ml-1">
              ({getCollectionLength(props.value)} items)
            </span>
          </span>
        </Show>
      </div>

      <Show when={!isPrimitive(props.value) && isExpanded()}>
        <div class="border-l border-secondary ml-2">
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

const EventDebugOverlay: Component = () => {
  const [isVisible, setIsVisible] = createSignal(false);
  const [selectedEvent, setSelectedEvent] = createSignal<EventLogEntry | null>(null);

  const getEventTypeColor = (type: string): string => {
    if (type.includes("Updated")) return "text-syntax-number";
    if (type.includes("Created")) return "text-syntax-string";
    if (type.includes("Deleted")) return "text-destructive";
    if (type.includes("Reveal")) return "text-syntax-date";
    if (type.includes("Hide")) return "text-link";
    return "text-muted-foreground";
  };

  const clearEvents = () => {
    eventLog.splice(0, eventLog.length);
    setSelectedEvent(null);
  };

  return (
    <>
      <div class="fixed top-16 right-4 z-[9999]">
        <button
          onClick={() => setIsVisible(!isVisible())}
          class="bg-primary hover:bg-primary-hover text-primary-foreground px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Events {isVisible() ? "Hide" : "Show"}
        </button>
      </div>

      <Show when={isVisible()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 z-[9998]" onClick={() => setIsVisible(false)} />
        <div class="fixed top-4 left-4 right-4 bottom-4 bg-background-dark border border-secondary rounded-lg z-[9999] flex">

          <div class="w-1/3 border-r border-secondary flex flex-col">
            <div class="flex items-center justify-between p-4 border-b border-secondary">
              <h3 class="text-lg font-semibold text-primary-foreground">Events ({eventLog.length})</h3>
              <div class="flex gap-2">
                <button
                  onClick={clearEvents}
                  class="bg-action-negative hover:bg-action-negative-hover text-primary-foreground px-2 py-1 rounded text-xs transition-colors"
                >
                  Clear
                </button>
                <button
                  onClick={() => setIsVisible(false)}
                  class="text-muted-foreground hover:text-primary-foreground transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-auto">
              <For each={[...eventLog].reverse()}>
                {(event) => (
                  <div
                    class={`p-3 border-b border-secondary cursor-pointer hover:bg-sidebar transition-colors ${selectedEvent()?.id === event.id ? "bg-accent" : ""
                      }`}
                    onClick={() => setSelectedEvent(event)}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class={`text-sm font-medium ${getEventTypeColor(event.type)}`}>
                        {event.type}
                      </span>
                      <span class="text-xs text-muted-foreground">
                        #{event.id}
                      </span>
                    </div>
                    <div class="text-xs text-muted-foreground">
                      {event.timestamp}
                    </div>
                  </div>
                )}
              </For>
              <Show when={eventLog.length === 0}>
                <div class="p-4 text-center text-muted-foreground">
                  No events logged yet
                </div>
              </Show>
            </div>
          </div>

          <div class="flex-1 flex flex-col">
            <div class="p-4 border-b border-secondary">
              <h3 class="text-lg font-semibold text-primary-foreground">Event Details</h3>
            </div>

            <div class="flex-1 overflow-auto p-4 bg-background">
              <Show when={selectedEvent()} fallback={
                <div class="text-center text-muted-foreground mt-8">
                  Select an event to view details
                </div>
              }>
                {(event) => (
                  <div>
                    <div class="mb-4 p-3 bg-sidebar rounded">
                      <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span class="text-muted-foreground">ID:</span>
                          <span class="text-primary-foreground ml-2">#{event().id}</span>
                        </div>
                        <div>
                          <span class="text-muted-foreground">Type:</span>
                          <span class={`ml-2 ${getEventTypeColor(event().type)}`}>
                            {event().type}
                          </span>
                        </div>
                        <div class="col-span-2">
                          <span class="text-muted-foreground">Timestamp:</span>
                          <span class="text-primary-foreground ml-2">{event().timestamp}</span>
                        </div>
                      </div>
                    </div>

                    <DebugItem label="data" value={event().data} />
                  </div>
                )}
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

export default EventDebugOverlay;
