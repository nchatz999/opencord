import { mergeProps, createSignal, Show, type Component, type JSX } from "solid-js";
import { cn } from "../utils";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "success";
  children: JSX.Element;
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

const Button: Component<ButtonProps> = (props) => {
  const [isLoading, setIsLoading] = createSignal(false);

  const merged = mergeProps(
    { variant: "primary" as const, size: "md" as const, fullWidth: false },
    props
  );

  const handleClick = async (e: MouseEvent) => {
    const result = merged.onClick?.(e);

    if (result instanceof Promise) {
      setIsLoading(true);
      try {
        await result;
      } finally {
        setIsLoading(false);
      }
    }
  };

  const baseStyles =
    "font-medium transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

  const variantStyles = {
    primary: "bg-accent-primary text-accent-primary-fg hover:bg-accent-primary-hover focus:ring-focus-ring",
    secondary: "bg-accent-secondary text-accent-secondary-fg hover:bg-accent-secondary-hover focus:ring-focus-ring",
    ghost: "bg-transparent text-fg-base hover:bg-accent-secondary hover:text-fg-emphasis focus:ring-focus-ring",
    destructive: "bg-status-danger text-status-danger-fg hover:bg-status-danger-hover focus:ring-status-danger",
    success: "bg-status-success text-accent-primary-fg hover:bg-status-success-hover focus:ring-status-success",
  };

  const sizeStyles = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-3",
    lg: "px-6 py-4 text-lg",
  };

  const loadingStyles = "opacity-70 cursor-wait";

  return (
    <button
      {...merged}
      onClick={handleClick}
      disabled={merged.disabled || isLoading()}
      class={cn(
        baseStyles,
        variantStyles[merged.variant],
        sizeStyles[merged.size],
        isLoading() && loadingStyles,
        merged.fullWidth && "w-full",
        merged.class
      )}
    >
      <Show
        when={!isLoading()}
        fallback={
          <span class="flex items-center gap-2 justify-center">
            <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
                fill="none"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        }
      >
        {merged.children}
      </Show>
    </button>
  );
};

export default Button;
