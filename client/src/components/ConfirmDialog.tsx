import {
  createContext,
  useContext,
  createSignal,
  Show,
  type Component,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import Button from "./Button";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "default";
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType>();

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmProvider");
  }
  return context.confirm;
};

export const ConfirmProvider: Component<{ children: JSX.Element }> = (props) => {
  const [state, setState] = createSignal<ConfirmState | null>(null);

  const confirm = (options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      const opts = typeof options === "string" ? { message: options } : options;
      setState({ ...opts, resolve });
    });
  };

  const handleConfirm = () => {
    state()?.resolve(true);
    setState(null);
  };

  const handleCancel = () => {
    state()?.resolve(false);
    setState(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {props.children}
      <Show when={state()}>
        {(current) => (
          <Portal>
            <div
              class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
              onClick={handleCancel}
              onKeyDown={handleKeyDown}
            >
              <div
                class="bg-bg-overlay text-fg-base rounded-lg p-6 w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Show when={current().title}>
                  <h3 class="text-lg font-semibold mb-2">{current().title}</h3>
                </Show>
                <p class="text-fg-muted mb-6">{current().message}</p>
                <div class="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCancel}>
                    {current().cancelText || "Cancel"}
                  </Button>
                  <Button
                    variant={current().variant === "danger" ? "destructive" : "primary"}
                    size="sm"
                    onClick={handleConfirm}
                  >
                    {current().confirmText || "Confirm"}
                  </Button>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </ConfirmContext.Provider>
  );
};
