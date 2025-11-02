import { mergeProps, type Component, type JSX } from "solid-js";
import { cn } from "../utils";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  children: JSX.Element;
  size?: "sm" | "md" | "lg";
}

const Button: Component<ButtonProps> = (props) => {
  
  const merged = mergeProps(
    { variant: "primary" as const, size: "md" as const },
    props
  );

  const baseStyles =
    "font-medium transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

  const variantStyles = {
    primary: "bg-[#5865f2] text-white hover:bg-[#4752c4] focus:ring-[#5865f2]",
    secondary:
      "bg-[#4f545c] text-white hover:bg-[#5d6269] focus:ring-[#4f545c]",
    ghost:
      "bg-transparent text-[#dcddde] hover:bg-[#4f545c] hover:text-white focus:ring-[#4f545c]",
    destructive:
      "bg-[#f04747] text-white hover:bg-[#d84040] focus:ring-[#f04747]",
  };

  const sizeStyles = {
    sm: "px-2 py-1 text-sm",
    md: "px-4 py-3",
    lg: "px-6 py-4 text-lg",
  };

  return (
    <button
      {...merged}
      class={cn(
        baseStyles,
        variantStyles[merged.variant],
        sizeStyles[merged.size],
        merged.class
      )}
    >
      {merged.children}
    </button>
  );
};

export default Button;
