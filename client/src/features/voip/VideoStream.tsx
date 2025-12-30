import type { Component, JSX } from "solid-js";
import { Show, createEffect, createMemo } from "solid-js";

import { Camera, Monitor, Volume2, Eye, EyeOff } from "lucide-solid";
import { useAuth, useSubscription, usePlayback, useUser } from "../../store/index";
import { MediaType } from "../../model";
import type { CallType } from "../../store/playback";
import type { VideoPlayback } from "../../lib/VideoPlayback";
import ContextMenu from "../../components/ContextMenu";
import type { ContextMenuItem } from "../../components/ContextMenu";
import Slider from "../../components/Slider";
import Button from "../../components/Button";

interface VideoStreamProps {
  publisherId: number;
  mediaType: MediaType;
  callType: CallType;
}

const CONTAINER_CLASS =
  "relative bg-sidebar rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]";

const VideoStream: Component<VideoStreamProps> = (props) => {
  const [, authActions] = useAuth();
  const [, subscriptionActions] = useSubscription();
  const [, playbackActions] = usePlayback();
  const [, userActions] = useUser();

  let videoRef: HTMLVideoElement | undefined;

  const viewer = () => authActions.getUser();
  const publisher = () => userActions.findById(props.publisherId);
  const isCamera = () => props.mediaType === MediaType.Camera;

  const isSubscribed = createMemo(() =>
    subscriptionActions.isSubscribedToMedia(viewer().userId, props.publisherId, props.mediaType)
  );

  const screenVolume = createMemo(() => playbackActions.getScreenAudioVolume(props.publisherId, props.callType));

  const mediaPlayback = () => {
    const type = isCamera() ? "camera" : "screen";
    return playbackActions.getPlayback(props.publisherId, type) as VideoPlayback | undefined;
  };

  const currentFps = createMemo(() => mediaPlayback()?.getFPS()() ?? 0);
  const dropRate = createMemo(() => mediaPlayback()?.getDropRate()() ?? 0);

  createEffect(() => {
    if (!videoRef) return;

    const playback = mediaPlayback();

    if (isSubscribed() && playback) {
      videoRef.srcObject = playback.getStream();
    } else {
      videoRef.srcObject = null;
      playback?.resetTimestamps();
    }
  });

  const toggleSubscription = async () => {
    if (isSubscribed()) {
      await subscriptionActions.unsubscribe(props.publisherId, props.mediaType);
    } else {
      await subscriptionActions.subscribe(props.publisherId, props.mediaType);
    }
  };

  const screenAudioMenuItems = (): ContextMenuItem[] => [
    {
      id: "volume-control",
      label: `Screen Audio: ${screenVolume()}%`,
      icon: <Volume2 size={16} />,
      onClick: () => { },
      customContent: (
        <div class="px-2 py-2">
          <Slider
            value={screenVolume()}
            min={0}
            max={200}
            onChange={(value) => playbackActions.adjustScreenAudio(props.publisherId, value, props.callType)}
            class="w-32"
          />
        </div>
      ),
    },
  ];

  const renderVideo = (): JSX.Element => (
    <video
      ref={videoRef}
      autoplay
      playsinline
      muted={true}
      class="w-full h-full object-cover"
    />
  );

  const renderPublisherBadge = (username: string): JSX.Element => (
    <div class="flex items-center gap-2 bg-black bg-opacity-60 rounded-full px-3 py-1.5">
      {isCamera() ? <Camera size={14} class="text-link" /> : <Monitor size={14} class="text-link" />}
      <span class="text-white text-sm font-medium truncate max-w-[120px]">{username}</span>
      <Show when={!isCamera() && screenVolume() === 0}>
        <Volume2 size={14} class="text-destructive" />
      </Show>
    </div>
  );

  const renderSubscriptionButton = (): JSX.Element => (
    <Button
      onClick={toggleSubscription}
      variant={isSubscribed() ? "primary" : "secondary"}
      size="sm"
      class="flex items-center gap-1.5 rounded"
    >
      {isSubscribed() ? <Eye size={14} /> : <EyeOff size={14} />}
      <span>{isSubscribed() ? "Watching" : "Paused"}</span>
    </Button>
  );

  const renderFpsIndicator = (): JSX.Element => (
    <div class="absolute top-2 right-2 flex flex-col gap-1">
      <div class="bg-black bg-opacity-60 rounded px-2 py-1 text-xs text-white font-mono">
        {currentFps()} FPS
      </div>
      <Show when={dropRate() > 0}>
        <div class="bg-black bg-opacity-60 rounded px-2 py-1 text-xs text-danger font-mono">
          {dropRate()}% loss
        </div>
      </Show>
    </div>
  );

  const renderOverlay = (username: string): JSX.Element => (
    <>
      <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        {renderPublisherBadge(username)}
        {renderSubscriptionButton()}
      </div>
      <Show when={!isCamera()}>
        {renderFpsIndicator()}
      </Show>
    </>
  );

  const renderContent = (username: string): JSX.Element => (
    <>
      {renderVideo()}
      {renderOverlay(username)}
    </>
  );

  return (
    <Show when={publisher()}>
      {(pub) => (
        <Show
          when={isCamera()}
          fallback={
            <ContextMenu items={screenAudioMenuItems()} class="relative bg-sidebar rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]">
              {renderContent(pub().username)}
            </ContextMenu>
          }
        >
          <div class={CONTAINER_CLASS}>
            {renderContent(pub().username)}
          </div>
        </Show>
      )}
    </Show>
  );
};

export default VideoStream;
