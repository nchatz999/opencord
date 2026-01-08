import type { Component, JSX } from "solid-js";
import { Show, createEffect, onCleanup } from "solid-js";

import { Camera, Monitor, Volume2, Eye, EyeOff } from "lucide-solid";
import { usePlayback, useUser } from "../../store/index";
import type { CallType } from "../../store/modal";
import Button from "../../components/Button";
import { getLiveKitManager, Track } from "../../lib/livekit";

interface VideoStreamProps {
  publisherId: number;
  mediaType: Track.Source.Camera | Track.Source.ScreenShare;
  callType: CallType;
}

const CONTAINER_CLASS =
  "relative bg-sidebar rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]";

const VideoStream: Component<VideoStreamProps> = (props) => {
  const [, playbackActions] = usePlayback();
  const [, userActions] = useUser();
  const livekit = getLiveKitManager();

  let videoRef: HTMLVideoElement | undefined;

  const publisher = () => userActions.findById(props.publisherId);

  const screenVolume = () => playbackActions.getScreenVolume(props.publisherId);
  const isSubscribed = () => playbackActions.isSubscribedToVideo(props.publisherId, props.mediaType);
  const track = () => playbackActions.getTrack(props.publisherId, props.mediaType);

  let currentTrack: ReturnType<typeof track> = undefined;

  createEffect(() => {
    if (!videoRef) return;

    const remoteTrack = track();

    if (remoteTrack === currentTrack) return;
    currentTrack = remoteTrack;

    if (remoteTrack) {
      remoteTrack.attach(videoRef);
    } else {
      videoRef.srcObject = null;
    }
  });

  onCleanup(() => {
    if (currentTrack && videoRef) {
      currentTrack.detach(videoRef);
    }
  });

  const toggleSubscription = () => {
    if (isSubscribed()) {
      if (props.mediaType == Track.Source.Camera) {
        livekit.unsubscribeFromCameraStream(props.publisherId);
      } else {
        livekit.unsubscribeFromScreenStream(props.publisherId);
      }
    } else {
      if (props.mediaType == Track.Source.Camera) {
        livekit.subscribeToCameraStream(props.publisherId);
      } else {
        livekit.subscribeToScreenStream(props.publisherId);
      }
    }
  };

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
      {props.mediaType == Track.Source.Camera ? <Camera size={14} class="text-link" /> : <Monitor size={14} class="text-link" />}
      <span class="text-white text-sm font-medium truncate max-w-[120px]">{username}</span>
      <Show when={props.mediaType == Track.Source.ScreenShare && screenVolume() === 0}>
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

  const renderOverlay = (username: string): JSX.Element => (
    <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
      {renderPublisherBadge(username)}
      {renderSubscriptionButton()}
    </div>
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
        <div class={CONTAINER_CLASS}>
          {renderContent(pub().username)}
        </div>
      )}
    </Show>
  );
};

export default VideoStream;
