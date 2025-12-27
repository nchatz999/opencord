import type { JSX, Component } from "solid-js";
import { Show, splitProps } from "solid-js";
import { cn } from "../utils";

interface CardProps {
  title?: string;
  icon?: JSX.Element;
  children: JSX.Element;
  class?: string;
}

interface CardSubProps {
  children: JSX.Element;
  class?: string;
}

const CardSub: Component<CardSubProps> = (props) => {
  const [local, rest] = splitProps(props, ["children", "class"]);

  return (
    <div class={cn("bg-input rounded-md p-3", local.class)} {...rest}>
      {local.children}
    </div>
  );
};

const Card: Component<CardProps> & { Sub: typeof CardSub } = (props) => {
  const [local, rest] = splitProps(props, ["title", "icon", "children", "class"]);

  return (
    <div class={cn("bg-card rounded-md p-4", local.class)} {...rest}>
      <Show when={local.title}>
        <h3 class="text-base font-medium mb-3 flex items-center text-foreground">
          <Show when={local.icon}>
            <span class="w-5 h-5 mr-2">{local.icon}</span>
          </Show>
          {local.title}
        </h3>
      </Show>
      {local.children}
    </div>
  );
};

Card.Sub = CardSub;

export default Card;
