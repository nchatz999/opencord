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
    primary: "bg-primary text-primary-foreground hover:bg-primary-hover focus:ring-ring",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary-hover focus:ring-secondary",
    ghost: "bg-transparent text-foreground hover:bg-secondary hover:text-primary-foreground focus:ring-secondary",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive-hover focus:ring-destructive",
    success: "bg-action-positive text-primary-foreground hover:bg-action-positive-hover focus:ring-action-positive",
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
