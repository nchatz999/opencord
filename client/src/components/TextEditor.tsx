import type { Component, JSX } from "solid-js";
import { Show, splitProps, createSignal, createEffect, on } from "solid-js";

interface TextEditorProps {
  ref?: (el: HTMLTextAreaElement) => void;
  value: string;
  onInput: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  placeholder?: string;
  format?: (text: string) => JSX.Element;
  class?: string;
  maxHeight?: number;
}

const TextEditor: Component<TextEditorProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "ref", "value", "onInput", "onKeyDown", "placeholder", "format", "class", "maxHeight",
  ]);

  let textareaRef: HTMLTextAreaElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [height, setHeight] = createSignal(40);
  const maxHeight = () => local.maxHeight ?? 120;

  const adjustHeight = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "0";
    const newHeight = Math.max(40, Math.min(textareaRef.scrollHeight, maxHeight()));
    textareaRef.style.height = `${newHeight}px`;
    setHeight(newHeight);
  };

  const handleInput = (e: Event) => {
    local.onInput((e.target as HTMLTextAreaElement).value);
    adjustHeight();
  };

  const setRef = (el: HTMLTextAreaElement) => {
    textareaRef = el;
    local.ref?.(el);
    adjustHeight();
  };

  createEffect(on(() => local.value, () => {
    adjustHeight();
  }));

  const showOverlay = () => local.format && local.value;

  return (
    <div class={`relative overflow-hidden ${local.class ?? ""}`} style={{ height: `${height()}px` }}>
      <textarea
        ref={setRef}
        value={local.value}
        onInput={handleInput}
        onKeyDown={local.onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        placeholder={local.placeholder}
        rows={1}
        class={`w-full min-w-full px-2 py-2 text-base leading-6 whitespace-pre-wrap break-words bg-transparent resize-none outline-none overflow-y-auto placeholder:text-muted-foreground-dark ${showOverlay() ? "text-transparent caret-foreground selection:bg-primary/30" : "text-foreground"}`}
        style={{ "max-height": `${maxHeight()}px`, "field-sizing": "content" }}
        {...rest}
      />
      <Show when={showOverlay()}>
        <div
          class="absolute top-0 left-0 right-0 px-2 py-2 text-base leading-6 whitespace-pre-wrap break-words pointer-events-none text-foreground"
          style={{ transform: `translateY(-${scrollTop()}px)` }}
        >
          {local.format!(local.value)}
        </div>
      </Show>
    </div>
  );
};

export default TextEditor;
