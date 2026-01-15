import { createSignal, createEffect, Show, type Component } from 'solid-js';

interface SliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  class?: string;
  disabled?: boolean;
  title?: string;
}

const Slider: Component<SliderProps> = (props) => {
  const min = () => props.min ?? 0;
  const max = () => props.max ?? 100;
  const step = () => props.step ?? 1;

  const [internalValue, setInternalValue] = createSignal(
    props.value ?? props.defaultValue ?? min()
  );

  const [isDragging, setIsDragging] = createSignal(false);
  let trackRef: HTMLDivElement | undefined;

  const value = () => props.value ?? internalValue();

  createEffect(() => {
    if (props.value !== undefined) {
      setInternalValue(props.value);
    }
  });

  const percentage = () => ((value() - min()) / (max() - min())) * 100;

  const updateValue = (clientX: number, rect: DOMRect) => {
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    let newValue = min() + percent * (max() - min());
    newValue = Math.round(newValue / step()) * step();
    newValue = Math.max(min(), Math.min(max(), newValue));

    setInternalValue(newValue);
    props.onChange?.(newValue);
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (props.disabled) return;
    setIsDragging(true);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    updateValue(e.clientX, rect);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging() || props.disabled || !trackRef) return;
    const rect = trackRef.getBoundingClientRect();
    updateValue(e.clientX, rect);
  };

  const handleMouseUp = () => {
    if (isDragging()) {
      setIsDragging(false);
      props.onChangeEnd?.(value());
    }
  };

  createEffect(() => {
    if (isDragging()) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  });

  return (
    <div class={props.class || 'w-full'}>
      <Show when={props.title}>
        <label class="block mb-2 text-sm font-medium text-fg-base">
          {props.title}
        </label>
      </Show>
      <div class="flex items-center gap-3">
        <div
          ref={trackRef}
          class={`relative flex-1 h-2 bg-bg-subtle rounded-full cursor-pointer ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          onMouseDown={handleMouseDown}
        >
          <div
            class="absolute h-full bg-accent-primary rounded-full "
            style={{ width: `${percentage()}%` }}
          />
          <div
            class={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${isDragging() ? 'scale-125' : 'scale-100'
              }`}
            style={{ left: `calc(${percentage()}% - 8px)` }}
          />
        </div>
      </div>
    </div>
  );
}
export default Slider;
