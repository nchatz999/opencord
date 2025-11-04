import { createSignal, createEffect, mergeProps, type Component } from 'solid-js';

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
  const merged = mergeProps(
    {
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 50,
      disabled: false,
    },
    props
  );

  const [internalValue, setInternalValue] = createSignal(
    props.value ?? merged.defaultValue
  );
  const [isDragging, setIsDragging] = createSignal(false);

  // Sync external value changes
  createEffect(() => {
    if (props.value !== undefined) {
      setInternalValue(props.value);
    }
  });

  const currentValue = () => props.value ?? internalValue();

  const percentage = () =>
    ((currentValue() - merged.min) / (merged.max - merged.min)) * 100;

  const handleChange = (e: Event) => {
    if (merged.disabled) return;
    const target = e.target as HTMLInputElement;
    const newValue = Number(target.value);
    setInternalValue(newValue);
    props.onChange?.(newValue);
  };

  const handleMouseDown = () => {
    if (!merged.disabled) {
      setIsDragging(true);
    }
  };

  const handleMouseUp = () => {
    if (isDragging()) {
      setIsDragging(false);
      props.onChangeEnd?.(currentValue());
    }
  };

  const handleTouchEnd = () => {
    if (!merged.disabled) {
      props.onChangeEnd?.(currentValue());
    }
  };

  return (
    <div class={`w-full ${merged.class || ''}`}>
      {merged.title && (
        <div class="mb-2 text-xs font-semibold text-gray-300 uppercase tracking-wide">
          {merged.title}
        </div>
      )}
      <div class="relative flex items-center">
        {/* Track */}
        <div class="absolute w-full h-1 bg-[#1e1f22] rounded-full">
          {/* Progress fill */}
          <div
            class="absolute h-full bg-[#5865f2] rounded-full transition-all"
            style={{ width: `${percentage()}%` }}
          />
        </div>

        {/* Input range */}
        <input
          type="range"
          min={merged.min}
          max={merged.max}
          step={merged.step}
          value={currentValue()}
          onInput={handleChange}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          disabled={merged.disabled}
          class={`
            relative w-full h-1 appearance-none bg-transparent cursor-pointer
            disabled:cursor-not-allowed disabled:opacity-50
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-webkit-slider-thumb]:active:cursor-grabbing
            [&::-webkit-slider-thumb]:active:scale-125
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white
            [&::-moz-range-thumb]:border-0
            [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:cursor-grab
            [&::-moz-range-thumb]:transition-transform
            [&::-moz-range-thumb]:hover:scale-110
            [&::-moz-range-thumb]:active:cursor-grabbing
            [&::-moz-range-thumb]:active:scale-125
          `}
        />
      </div>
    </div>
  );
};

export default Slider;
