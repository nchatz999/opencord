import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
  mergeProps,
  type Component,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { X, CheckCircle, AlertCircle } from "lucide-solid";

interface ToastType {
  id: number;
  message: string;
  type: "success" | "error";
}

interface ToasterContextType {
  addToast: (message: string, type: "success" | "error") => void;
}

const ToasterContext = createContext<ToasterContextType>();

export const useToaster = () => {
  const context = useContext(ToasterContext);
  if (!context) {
    throw new Error("useToaster must be used within a ToasterProvider");
  }
  return context;
};

interface ToasterProps {
  message: string;
  type: "success" | "error";
  duration?: number;
  onClose: () => void;
}

const Toaster: Component<ToasterProps> = (props) => {
  const merged = mergeProps({ duration: 3000 }, props);
  const [isVisible, setIsVisible] = createSignal(true);

  createEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      merged.onClose();
    }, merged.duration);

    onCleanup(() => clearTimeout(timer));
  });

  return (
    <Show when={isVisible()}>
      <Portal>
        <div class="fixed inset-0 flex items-end justify-center px-4 py-6 pointer-events-none sm:p-6 sm:items-start sm:justify-end z-50">
          <div
            class={`
              max-w-sm w-full bg-popover text-foreground rounded-lg shadow-lg
              pointer-events-auto flex items-center p-4 gap-4
              ${
                merged.type === "success"
                  ? "border-l-4 border-toast-success"
                  : "border-l-4 border-toast-error"
              }
            `}
          >
            <div class="flex-shrink-0">
              <Show
                when={merged.type === "success"}
                fallback={<AlertCircle class="w-6 h-6 text-toast-error" />}
              >
                <CheckCircle class="w-6 h-6 text-toast-success" />
              </Show>
            </div>
            <div class="flex-grow">
              <p class="text-sm font-medium">{merged.message}</p>
            </div>
            <button
              onClick={() => {
                setIsVisible(false);
                merged.onClose();
              }}
              class="flex-shrink-0 ml-4 text-muted-foreground hover:text-foreground-bright focus:outline-none"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export const ToasterProvider: Component<{ children: JSX.Element }> = (
  props
) => {
  const [toasts, setToasts] = createSignal<ToastType[]>([]);

  const addToast = (message: string, type: "success" | "error" = "error") => {
    const id = Date.now();
    setToasts((prevToasts) => [...prevToasts, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
  };

  return (
    <ToasterContext.Provider value={{ addToast }}>
      {props.children}
      <For each={toasts()}>
        {(toast) => (
          <Toaster
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        )}
      </For>
    </ToasterContext.Provider>
  );
};
