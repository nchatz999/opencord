import { mergeProps, type Component, type JSX } from "solid-js";
import { cn } from "../utils";

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
      defaultValue: 50,
      min: 0,
      max: 100,
      step: 1,
      disabled: false,
    },
    props
  );

  const handleChange: JSX.EventHandler<HTMLInputElement, Event> = (e) => {
    const newValue = Number(e.currentTarget.value);
    merged.onChange?.(newValue);
  };

  const handleMouseUp: JSX.EventHandler<HTMLInputElement, MouseEvent> = (e) => {
    const newValue = Number(e.currentTarget.value);
    merged.onChangeEnd?.(newValue);
  };

  return (
    <div class={cn("relative flex items-center", merged.class)}>
      <input
        type="range"
        min={merged.min}
        max={merged.max}
        step={merged.step}
        value={merged.value}
        onInput={handleChange}
        onMouseUp={handleMouseUp}
        disabled={merged.disabled}
        title={merged.title}
        class={cn(
          "w-full h-1 bg-[#4f545c] rounded-lg appearance-none cursor-pointer",
          "focus:outline-none focus:ring-0",
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:w-3",
          "[&::-webkit-slider-thumb]:h-3",
          "[&::-webkit-slider-thumb]:bg-[#DBDEE1]",
          "[&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:cursor-pointer",
          "[&::-webkit-slider-thumb]:transition-all",
          "[&::-webkit-slider-thumb]:hover:bg-[#00A8FC]",
          "[&::-webkit-slider-thumb]:hover:scale-110",
          "[&::-moz-range-thumb]:w-3",
          "[&::-moz-range-thumb]:h-3",
          "[&::-moz-range-thumb]:bg-[#DBDEE1]",
          "[&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:cursor-pointer",
          "[&::-moz-range-thumb]:border-0",
          "[&::-moz-range-thumb]:transition-all",
          "[&::-moz-range-thumb]:hover:bg-[#00A8FC]",
          "[&::-moz-range-thumb]:hover:scale-110",
          "[&::-webkit-slider-runnable-track]:rounded-lg",
          "[&::-webkit-slider-runnable-track]:bg-[#4f545c]",
          "[&::-moz-range-track]:rounded-lg",
          "[&::-moz-range-track]:bg-[#4f545c]",
          merged.disabled && "opacity-50 cursor-not-allowed"
        )}
      />
    </div>
  );
};

export default Slider;
