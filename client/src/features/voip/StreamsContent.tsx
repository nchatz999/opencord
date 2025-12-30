import type { Component } from "solid-js";
import { For, Show, createMemo, createSignal } from "solid-js";

import { Users, Video, X, Maximize2, Minimize2, Expand } from "lucide-solid";
import { useAuth, useVoip, useContext } from "../../store/index";
import { type VoipParticipant, MediaType } from "../../model";
import VideoStream from "./VideoStream";
import Button from "../../components/Button";

type FocusedStream = { publisherId: number; mediaType: MediaType } | null;


const StreamsContent: Component = () => {
  const [, authActions] = useAuth();
  const [, voipActions] = useVoip();
  const [contextState] = useContext();
  const currentUser = () => authActions.getUser();

  const callType = () => {
    const session = voipActions.findById(currentUser().userId);
    return session?.recipientId ? "private" : "channel";
  };

  const [focusedStream, setFocusedStream] = createSignal<FocusedStream>(null);
  const [isModalFullscreen, setIsModalFullscreen] = createSignal(false);

  const openStreamModal = (publisherId: number, mediaType: MediaType) => {
    setFocusedStream({ publisherId, mediaType });
    setIsModalFullscreen(false);
  };

  const closeStreamModal = () => {
    setFocusedStream(null);
    setIsModalFullscreen(false);
  };

  const getCurrentParticipants = createMemo(() => {
    const voipSession = voipActions.findById(currentUser().userId);

    if (!voipSession) {
      return [];
    }

    if (voipSession.channelId) {
      return voipActions.list().filter((part) => (part.publishCamera || part.publishScreen) && part.channelId == voipSession.channelId);
    } else if (voipSession.recipientId) {
      return voipActions.list().filter((part) => (part.publishCamera || part.publishScreen) && (part.userId == voipSession.recipientId || part.recipientId == voipSession.userId));
    }
    return [];
  });

  const streamCount = createMemo(() =>
    getCurrentParticipants().reduce((count, p) => count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0), 0)
  );

  const getGridCols = (participants: VoipParticipant[]) => {
    const totalStreams = participants.reduce((count, p) => {
      return count + (p.publishCamera ? 1 : 0) + (p.publishScreen ? 1 : 0);
    }, 0);

    if (totalStreams === 1) return "grid-cols-1";
    if (totalStreams === 2) return "grid-cols-2";
    if (totalStreams <= 4) return "grid-cols-2";
    if (totalStreams <= 6) return "grid-cols-3";
    return "grid-cols-4";
  };

  return (
    <Show
      when={voipActions.findById(currentUser().userId)}
      fallback={
        <div class="flex-1 flex items-center justify-center text-muted-foreground">
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
          <div class="flex-1 flex items-center justify-center text-muted-foreground mt-6">
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
          <div class="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
            <div class="flex items-center gap-2">
              <Video size={20} class="text-muted-foreground" />
              <h3 class="text-foreground font-medium">
                <Show when={contextState.context}>
                  {(context) =>
                    context().type === 'channel'
                      ? `Channel Voice`
                      : `Private Call`
                  }
                </Show>
              </h3>
            </div>

            <div class="flex items-center gap-2 text-sm text-muted-foreground">
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
                    <Show when={participant.publishCamera}>
                      <div class="relative group">
                        <VideoStream
                          publisherId={participant.userId}
                          mediaType={MediaType.Camera}
                          callType={callType()}
                        />
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <Button
                            variant="ghost"
                            class="p-3 rounded-full bg-background/60 pointer-events-auto"
                            onClick={() => openStreamModal(participant.userId, MediaType.Camera)}
                          >
                            <Expand size={24} />
                          </Button>
                        </div>
                      </div>
                    </Show>
                    <Show when={participant.publishScreen}>
                      <div class="relative group">
                        <VideoStream
                          publisherId={participant.userId}
                          mediaType={MediaType.Screen}
                          callType={callType()}
                        />
                        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <Button
                            variant="ghost"
                            class="p-3 rounded-full bg-background/60 pointer-events-auto"
                            onClick={() => openStreamModal(participant.userId, MediaType.Screen)}
                          >
                            <Expand size={24} />
                          </Button>
                        </div>
                      </div>
                    </Show>
                  </>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={focusedStream()}>
        {(stream) => (
          <div
            class={`fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm ${
              isModalFullscreen() ? "" : "p-8"
            }`}
            onClick={(e) => {
              if (e.target === e.currentTarget) closeStreamModal();
            }}
          >
            <div
              class={`relative bg-sidebar border border-border rounded-lg overflow-hidden flex flex-col ${
                isModalFullscreen()
                  ? "w-full h-full rounded-none border-none"
                  : "w-full max-w-5xl max-h-[90vh]"
              }`}
            >
              <div class="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                <span class="text-sm text-muted-foreground">
                  {stream().mediaType === MediaType.Camera ? "Camera" : "Screen Share"}
                </span>
                <div class="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsModalFullscreen((prev) => !prev)}
                    title={isModalFullscreen() ? "Exit fullscreen" : "Fullscreen"}
                  >
                    {isModalFullscreen() ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={closeStreamModal}
                    title="Close"
                  >
                    <X size={18} />
                  </Button>
                </div>
              </div>

              <div class="flex-1 min-h-0">
                <VideoStream
                  publisherId={stream().publisherId}
                  mediaType={stream().mediaType}
                  callType={callType()}
                />
              </div>
            </div>
          </div>
        )}
      </Show>
    </Show>
  );
};

export default StreamsContent;
