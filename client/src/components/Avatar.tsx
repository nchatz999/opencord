import { Show, type Component } from "solid-js";
import { User } from "lucide-solid";
import { cn } from "../utils";
import ImagePreview from "./ImagePreview";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface AvatarProps {
  avatarFileId: number | null | undefined;
  alt?: string;
  class?: string;
  size?: AvatarSize;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: "w-6 h-6",
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
  xl: "w-24 h-24",
};

const iconSizes: Record<AvatarSize, number> = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 26,
  xl: 48,
};

const Avatar: Component<AvatarProps> = (props) => {
  const size = () => props.size ?? "sm";

  return (
    <Show
      when={props.avatarFileId}
      fallback={
        <div
          class={cn(
            "rounded-full bg-bg-overlay flex items-center justify-center flex-shrink-0",
            sizeClasses[size()],
            props.class
          )}
        >
          <User size={iconSizes[size()]} class="text-fg-muted" />
        </div>
      }
    >
      <ImagePreview
        src={`/user/${props.avatarFileId}/avatar`}
        alt={props.alt ?? "Avatar"}
        placeholderClass="bg-bg-overlay"
        class={cn(
          "rounded-full object-cover flex-shrink-0",
          sizeClasses[size()],
          props.class
        )}
      />
    </Show>
  );
};

export default Avatar;
