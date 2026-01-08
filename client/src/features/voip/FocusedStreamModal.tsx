import type { Component } from "solid-js";
import { Show, createSignal } from "solid-js";
import { X, Maximize2, Minimize2, Volume2, VolumeX, Camera, Monitor } from "lucide-solid";
import { useModal, usePlayback } from "../../store/index";
import type { CallType } from "../../store/modal";
import { MediaType } from "../../model";
import Button from "../../components/Button";
import Slider from "../../components/Slider";
import VideoStream from "./VideoStream";

interface FocusedStreamModalProps {
  publisherId: number;
  mediaType: MediaType;
  callType: CallType;
}

const FocusedStreamModal: Component<FocusedStreamModalProps> = (props) => {
  const [, modalActions] = useModal();
  const [, playbackActions] = usePlayback();
  const [isFullscreen, setIsFullscreen] = createSignal(false);

  const screenVolume = () => playbackActions.getScreenVolume(props.publisherId);
  const isCamera = () => props.mediaType === MediaType.Camera;

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        class={`bg-popover rounded-lg overflow-hidden flex flex-col ${isFullscreen()
          ? "w-full h-full rounded-none m-0"
          : "w-full max-w-5xl max-h-[90vh] mx-4"
          }`}
      >
        <div class="flex justify-between items-center p-6 pb-4">
          <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
            {isCamera() ? <Camera class="w-6 h-6" /> : <Monitor class="w-6 h-6" />}
            {isCamera() ? "Camera" : "Screen Share"}
          </h2>
          <div class="flex items-center gap-2">
            <Button
              onClick={() => setIsFullscreen((prev) => !prev)}
              variant="ghost"
              size="sm"
              title={isFullscreen() ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen() ? <Minimize2 class="w-6 h-6" /> : <Maximize2 class="w-6 h-6" />}
            </Button>
            <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
              <X class="w-6 h-6" />
            </Button>
          </div>
        </div>

        <Show when={!isCamera()}>
          <div class="flex items-center gap-3 px-6 pb-4">
            <Show
              when={screenVolume() !== undefined}
              fallback={
                <div class="flex items-center gap-2 text-muted-foreground">
                  <VolumeX size={18} />
                  <span class="text-sm">No audio</span>
                </div>
              }
            >
              <Volume2 size={18} class="text-muted-foreground shrink-0" />
              <Slider
                min={0}
                max={200}
                value={screenVolume()!}
                onChange={(v) => playbackActions.setScreenVolume(props.publisherId, v)}
                class="w-64"
              />
              <span class="text-sm text-muted-foreground w-12">
                {Math.round(screenVolume()!)}%
              </span>
            </Show>
          </div>
        </Show>

        <div class="flex-1 min-h-0 px-6 pb-6">
          <div class="h-full rounded-lg overflow-hidden">
            <VideoStream
              publisherId={props.publisherId}
              mediaType={props.mediaType}
              callType={props.callType}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FocusedStreamModal;
