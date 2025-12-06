import type { Component } from "solid-js";
import { For, Show, createSignal, createMemo, onCleanup } from "solid-js";

import { Camera, Monitor, Users, Video, Volume2, Eye, EyeOff } from "lucide-solid";
import { voipDomain, messageDomain } from "../store";
import { type VoipParticipantWithUser, MediaType } from "../model";
import { fetchApi } from "../utils";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import Slider from "../components/Slider";
import Button from "../components/Button";


const StreamsContent: Component = () => {
  const [isFullscreen, setIsFullscreen] = createSignal(false);

  const handleFullscreenChange = () => {
    setIsFullscreen(!!document.fullscreenElement);
  };

  document.addEventListener('fullscreenchange', handleFullscreenChange);
  onCleanup(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  });

  const getCurrentParticipants = createMemo(() => {
    const voipSession = voipDomain.getCurrent();

    if (!voipSession) {
      return [] as VoipParticipantWithUser[];
    }

    if (voipSession.channelId) {
      return voipDomain.list().filter((part) => (part.publishCamera || part.publishScreen) && part.channelId == voipSession.channelId);
    } else if (voipSession.recipientId) {
      return voipDomain.list().filter((part) => (part.publishCamera || part.publishScreen) && (part.user.userId == voipSession.recipientId || part.recipientId == voipSession.userId));
    }

    return [] as VoipParticipantWithUser[];
  });

  const streamCount = createMemo(() =>
    getCurrentParticipants().reduce((count, p) => count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0), 0)
  );

  const getGridCols = (participants: VoipParticipantWithUser[]) => {

    const totalStreams = participants.reduce((count, p) => {
      return count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0);
    }, 0);

    if (totalStreams === 1) return "grid-cols-1";
    if (totalStreams === 2) return "grid-cols-2";
    if (totalStreams <= 4) return "grid-cols-2";
    if (totalStreams <= 6) return "grid-cols-3";
    return "grid-cols-4";
  };

  const toggleSubscription = async (publisherId: number, mediaType: MediaType) => {
    const isCurrentlySubscribed = voipDomain.isSubscribedToMedia(publisherId, mediaType);
    const endpoint = isCurrentlySubscribed ? '/voip/unsubscribe' : '/voip/subscribe';
    const result = await fetchApi(endpoint, {
      method: 'POST',
      body: {
        publisherId,
        mediaType
      }
    });

    if (result.isErr()) {
      // Subscription toggle failed silently - user can retry
    }
  };

  const createVolumeMenuItems = (userId: number): ContextMenuItem[] => {
    const volumePercentage = voipDomain.getScreenAudioVolume(userId);

    return [
      {
        id: "volume-control",
        label: `Screen Audio: ${volumePercentage}%`,
        icon: <Volume2 size={16} />,
        onClick: () => { },
        customContent: (
          <div class="px-2 py-2">
            <Slider
              value={volumePercentage}
              min={0}
              max={200}
              onChange={(value) => {
                voipDomain.adjustScreenAudio(userId, value);
              }}
              class="w-32"
            />
          </div>
        ),
      },
    ];
  };

  return (
    <Show
      when={voipDomain.getCurrent()}
      fallback={
        <div class="flex-1 flex items-center justify-center text-[#949ba4]">
          <div class="text-center">
            <Video size={48} class="mx-auto mb-4 mt-4 opacity-50" />
            <h3 class="text-lg font-medium mb-1">No active stream</h3>
            <p class="text-sm">Join a voice channel or start a video call</p>
          </div>
        </div>
      }
    >
      <Show
        when={getCurrentParticipants().length > 0}
        fallback={
          <div class="flex-1 flex items-center justify-center text-[#949ba4] mt-6">
            <div class="text-center">
              <Users size={48} class="mx-auto mb-4 mt-4 opacity-50" />
              <h3 class="text-lg font-medium mb-1">No one in voice</h3>
              <p class="text-sm">
                Users need to join the voice channel to appear here"
              </p>
            </div>
          </div>
        }
      >
        <div class="flex-1 flex flex-col min-h-0">
          <div class="flex items-center justify-between px-4 py-3 border-b border-[#1e1f22] bg-[#313338] shrink-0">
            <div class="flex items-center gap-2">
              <Video size={20} class="text-[#949ba4]" />
              <h3 class="text-[#DBDEE1] font-medium">
                <Show when={messageDomain.getContext()}>
                  {(context) =>
                    context().type === 'channel'
                      ? `Channel Voice`
                      : `Private Call`
                  }
                </Show>
              </h3>
            </div>

            <div class="flex items-center gap-2 text-sm text-[#949ba4]">
              <Users size={16} />
              <span>
                {streamCount()} stream{streamCount() !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div class="flex-1 min-h-0 overflow-auto">
            <div
              class={`grid gap-4 h-full p-4 ${getGridCols(getCurrentParticipants())}`}
            >
              <For each={getCurrentParticipants()}>
                {(participant) => (
                  <>
                    {}
                    <Show when={participant.publishCamera}>
                      <div class="relative bg-[#2b2d31] rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]">
                        <video
                          ref={(ref) => {
                            if (participant.cameraPlayback) {
                              const mediaStream = participant.cameraPlayback.getStream();
                              if (mediaStream) {
                                ref.srcObject = mediaStream;
                              }
                            }
                          }}
                          autoplay
                          playsinline
                          muted={true}
                          class="w-full h-full object-cover cursor-pointer"
                          onDblClick={(e) => {
                            const video = e.currentTarget;
                            if (document.fullscreenElement) {
                              document.exitFullscreen();
                            } else {
                              video.requestFullscreen();
                            }
                          }}
                        />

                        <Show when={!isFullscreen()}>
                          <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                            <div class="flex items-center gap-2 bg-black bg-opacity-60 rounded-full px-3 py-1.5">
                              <Camera size={14} class="text-blue-400" />
                              <span class="text-white text-sm font-medium truncate max-w-[120px]">
                                {participant.user.username}
                              </span>
                            </div>

                            <Button
                              onClick={() => toggleSubscription(participant.user.userId, MediaType.Camera)}
                              variant={voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Camera) ? 'primary' : 'secondary'}
                              size="sm"
                              class="flex items-center gap-1.5 rounded"
                            >
                              {voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Camera) ?
                                <Eye size={14} /> :
                                <EyeOff size={14} />
                              }
                              <span>
                                {voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Camera) ? 'Watching' : 'Paused'}
                              </span>
                            </Button>
                          </div>
                        </Show>
                      </div>
                    </Show>

                    <Show when={participant.publishScreen}>
                      <ContextMenu
                        items={createVolumeMenuItems(participant.user.userId)}
                        class="relative bg-[#2b2d31] rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]"
                      >
                        <video
                          ref={(ref) => {
                            if (participant.screenPlayback) {
                              const mediaStream = participant.screenPlayback.getStream();
                              if (mediaStream) {
                                ref.srcObject = mediaStream;
                              }
                            }
                          }}
                          autoplay
                          playsinline
                          muted={true}
                          class="w-full h-full object-cover cursor-pointer"
                          onDblClick={(e) => {
                            const video = e.currentTarget;
                            if (document.fullscreenElement) {
                              document.exitFullscreen();
                            } else {
                              video.requestFullscreen();
                            }
                          }}
                        />


                        <Show when={!isFullscreen()}>
                          <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                            <div class="flex items-center gap-2 bg-black bg-opacity-60 rounded-full px-3 py-1.5">
                              <Monitor size={14} class="text-blue-400" />
                              <span class="text-white text-sm font-medium truncate max-w-[120px]">
                                {participant.user.username}
                              </span>
                              <Show when={voipDomain.getScreenAudioVolume(participant.user.userId) === 0}>
                                <Volume2 size={14} class="text-red-400" />
                              </Show>
                            </div>

                            <Button
                              onClick={() => toggleSubscription(participant.user.userId, MediaType.Screen)}
                              variant={voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Screen) ? 'primary' : 'secondary'}
                              size="sm"
                              class="flex items-center gap-1.5 rounded"
                            >
                              {voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Screen) ?
                                <Eye size={14} /> :
                                <EyeOff size={14} />
                              }
                              <span>
                                {voipDomain.isSubscribedToMedia(participant.user.userId, MediaType.Screen) ? 'Watching' : 'Paused'}
                              </span>
                            </Button>
                          </div>

                          <div class="absolute top-2 right-2">
                            <div class="bg-black bg-opacity-60 rounded px-2 py-1 text-xs text-white font-mono">
                              {participant?.screenPlayback?.getFPS()() || 0} FPS
                            </div>
                          </div>
                        </Show>
                      </ContextMenu>
                    </Show>
                  </>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default StreamsContent;
