import type { Component } from "solid-js";
import { For, Show } from "solid-js";

import { Camera, Monitor, Users, Video, Volume2 } from "lucide-solid";
import { voipDomain, messageDomain } from "../store";
import type { VoipParticipantWithUser } from "../model";
import ContextMenu from "../components/ContextMenu";
import type { ContextMenuItem } from "../components/ContextMenu";
import Slider from "../components/Slider";


const StreamsContent: Component = () => {

  const getCurrentParticipants = () => {
    const context = voipDomain.getVoipContext();

    if (!context) {
      return [] as VoipParticipantWithUser[];
    }

    if (context.type === 'channel') {
      return voipDomain.getParticipants().filter((part) => (part.publishCamera || part.publishScreen) && part.channelId == context.id || part.user.userId == context.id);
    } else if (context.type === 'dm') {
      return voipDomain.getParticipants().filter((part) => (part.publishCamera || part.publishScreen) && part.recipientId == context.id || part.user.userId == context.id);
    }

    return [] as VoipParticipantWithUser[];
  }

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

  const createVolumeMenuItems = (userId: number): ContextMenuItem[] => {
    const volumePercentage = voipDomain.getUserScreenSoundVolume(userId);

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
                voipDomain.setUserScreenSoundVolume(userId, value);
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
      when={voipDomain.getCurrentUserParticipant()}
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
          {}
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
                {getCurrentParticipants().reduce((count, p) => count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0), 0)} stream
                {getCurrentParticipants().reduce((count, p) => count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0), 0) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {}
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

                        {}
                        <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                          <div class="flex items-center gap-1 bg-black bg-opacity-50 rounded-full px-2 py-1">
                            <span class="text-white text-xs font-medium truncate max-w-[100px]">
                              {participant.user.username}
                            </span>
                          </div>

                          <div class="flex items-center gap-1">
                            <div class="p-1 rounded-full bg-blue-500 bg-opacity-80">
                              <Camera size={12} class="text-white" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </Show>

                    {}
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

                        {}
                        <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                          <div class="flex items-center gap-1 bg-black bg-opacity-50 rounded-full px-2 py-1">
                            <span class="text-white text-xs font-medium truncate max-w-[100px]">
                              {participant.user.username}
                            </span>
                          </div>

                          <div class="flex items-center gap-1">
                            <div class="p-1 rounded-full bg-blue-500 bg-opacity-80">
                              <Monitor size={12} class="text-white" />
                            </div>
                            <Show when={voipDomain.getUserScreenSoundVolume(participant.user.userId) === 0}>
                              <div class="p-1 rounded-full bg-red-500 bg-opacity-80">
                                <Volume2 size={12} class="text-white" />
                              </div>
                            </Show>
                          </div>
                        </div>
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
