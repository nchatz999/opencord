import type { Component } from "solid-js";
import { Show, Switch, Match, createEffect, onCleanup } from "solid-js";

import { Camera, Monitor, Eye, EyeOff } from "lucide-solid";
import { useUser } from "../../store/index";
import type { CallType } from "../../store/modal";
import Button from "../../components/Button";
import { getLiveKitManager, Track } from "../../lib/livekit";

interface VideoStreamProps {
    publisherId: number;
    mediaType: Track.Source.Camera | Track.Source.ScreenShare;
    callType: CallType;
}

const VideoStream: Component<VideoStreamProps> = (props) => {
    const [, userActions] = useUser();
    const livekit = getLiveKitManager();

    let videoRef: HTMLVideoElement | undefined;

    const publisher = () => userActions.findById(props.publisherId);
    const isSubscribed = () => livekit.isSubscribedToVideo(props.publisherId, props.mediaType);
    const track = () => livekit.getTrack(props.publisherId, props.mediaType);

    createEffect(() => {
        const remoteTrack = track();
        if (!videoRef) return;
        if (remoteTrack) {
            remoteTrack.attach(videoRef);
            onCleanup(() => remoteTrack.detach(videoRef));
        } else {
            videoRef.srcObject = null;
        }
    });

    const toggleSubscription = () => {
        const { publisherId, mediaType } = props;
        switch (mediaType) {
            case Track.Source.Camera:
                isSubscribed() ? livekit.unsubscribeFromCameraStream(publisherId) : livekit.subscribeToCameraStream(publisherId);
                break;
            case Track.Source.ScreenShare:
                isSubscribed() ? livekit.unsubscribeFromScreenStream(publisherId) : livekit.subscribeToScreenStream(publisherId);
                break;
        }
    };

    return (
        <Show when={publisher()}>
            {(pub) => (
                <div class="relative bg-sidebar rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]">
                    <video
                        ref={videoRef}
                        autoplay
                        playsinline
                        muted={true}
                        class="w-full h-full object-cover"
                    />

                    <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                        <div class="flex items-center gap-2 bg-black bg-opacity-60 rounded-full px-3 py-1.5">
                            <Switch>
                                <Match when={props.mediaType === Track.Source.Camera}>
                                    <Camera size={14} class="text-link" />
                                </Match>
                                <Match when={props.mediaType === Track.Source.ScreenShare}>
                                    <Monitor size={14} class="text-link" />
                                </Match>
                            </Switch>
                            <span class="text-white text-sm font-medium truncate max-w-[120px]">{pub().username}</span>
                        </div>

                        <Button
                            onClick={toggleSubscription}
                            variant={isSubscribed() ? "primary" : "secondary"}
                            size="sm"
                            class="flex items-center gap-1.5 rounded"
                        >
                            {isSubscribed() ? <Eye size={14} /> : <EyeOff size={14} />}
                            <span>{isSubscribed() ? "Watching" : "Paused"}</span>
                        </Button>
                    </div>
                </div>
            )}
        </Show>
    );
};

export default VideoStream;
