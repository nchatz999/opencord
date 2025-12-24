import {
  createSignal,
  Show,
  For,
  onMount,
  type Component,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import Button from "./Button";

const [sources, setSources] = createSignal<ScreenSource[] | null>(null);

export const DevicePickerProvider: Component<{ children: JSX.Element }> = (props) => {
  onMount(() => {
    if (window.electronAPI) {
      window.electronAPI.onShowScreenPicker((s) => {
        setSources(s);
      });
    }
  });

  const handleSelect = (sourceId: string) => {
    window.electronAPI?.selectScreen(sourceId);
    setSources(null);
  };

  const handleCancel = () => {
    window.electronAPI?.selectScreen(null);
    setSources(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  const screens = () => sources()?.filter(s => s.id.startsWith('screen:')) || [];
  const windows = () => sources()?.filter(s => s.id.startsWith('window:')) || [];

  return (
    <>
      {props.children}
      <Show when={sources()}>
        <Portal>
          <div
            class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            onClick={handleCancel}
            onKeyDown={handleKeyDown}
          >
            <div
              class="bg-popover text-foreground rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden border border-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div class="p-5 border-b border-border">
                <h2 class="text-xl font-semibold text-foreground-bright">Share your screen</h2>
                <p class="text-sm text-muted-foreground mt-1">Choose what you'd like to share</p>
              </div>

              <div class="p-5 overflow-y-auto max-h-[60vh]">
                <Show when={screens().length > 0}>
                  <div class="mb-6">
                    <h3 class="text-sm font-medium text-muted-foreground mb-3">Screens</h3>
                    <div class="grid grid-cols-2 gap-3">
                      <For each={screens()}>
                        {(source) => (
                          <button
                            class="group relative rounded-lg overflow-hidden border-2 border-transparent hover:border-primary focus:border-primary focus:outline-none transition-all bg-card"
                            onClick={() => handleSelect(source.id)}
                          >
                            <div class="aspect-video bg-background-dark">
                              <img
                                src={source.thumbnail}
                                alt={source.name}
                                class="w-full h-full object-contain"
                              />
                            </div>
                            <div class="p-2 bg-card">
                              <p class="text-sm text-foreground truncate">
                                {source.name || 'Entire Screen'}
                              </p>
                            </div>
                            <div class="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={windows().length > 0}>
                  <div>
                    <h3 class="text-sm font-medium text-muted-foreground mb-3">Windows</h3>
                    <div class="grid grid-cols-2 gap-3">
                      <For each={windows()}>
                        {(source) => (
                          <button
                            class="group relative rounded-lg overflow-hidden border-2 border-transparent hover:border-primary focus:border-primary focus:outline-none transition-all bg-card"
                            onClick={() => handleSelect(source.id)}
                          >
                            <div class="aspect-video bg-background-dark">
                              <img
                                src={source.thumbnail}
                                alt={source.name}
                                class="w-full h-full object-contain"
                              />
                            </div>
                            <div class="p-2 bg-card flex items-center gap-2">
                              <Show when={source.appIcon}>
                                <img
                                  src={source.appIcon!}
                                  alt=""
                                  class="w-4 h-4 flex-shrink-0"
                                />
                              </Show>
                              <p class="text-sm text-foreground truncate">
                                {source.name || 'Window'}
                              </p>
                            </div>
                            <div class="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={sources()?.length === 0}>
                  <div class="text-center py-12">
                    <p class="text-muted-foreground">No screens or windows available</p>
                  </div>
                </Show>
              </div>

              <div class="p-4 border-t border-border flex justify-end">
                <Button variant="secondary" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
};
