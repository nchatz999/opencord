import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { VoipParticipant } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { usePlayback } from "./playback";
import { useAuth } from "./auth";
import { useMicrophone } from "./microphone";
import { useScreenShare } from "./screenShare";
import { useCamera } from "./camera";
import { useSound } from "./sound";

interface VoipState {
  voipState: VoipParticipant[];
}

interface VoipActions {
  init: () => Promise<Result<void, string>>;
  cleanup: () => void;
  list: () => VoipParticipant[];
  findByChannel: (channelId: number) => VoipParticipant[];
  findById: (userId: number) => VoipParticipant | undefined;
  replaceAll: (participants: VoipParticipant[]) => void;
  add: (participant: VoipParticipant) => void;
  update: (participant: VoipParticipant) => void;
  remove: (userId: number) => void;
  removeByChannel: (channelId: number) => void;
  unpublishAll: (userId: number) => void;
  joinChannel: (channelId: number, muted: boolean, deafened: boolean) => Promise<Result<void, string>>;
  joinPrivate: (userId: number, muted: boolean, deafened: boolean) => Promise<Result<void, string>>;
  leave: () => Promise<Result<void, string>>;
  setMuted: (muted: boolean) => Promise<Result<void, string>>;
  setDeafened: (deafened: boolean) => Promise<Result<void, string>>;
  publishScreen: (publish: boolean) => Promise<Result<void, string>>;
  publishCamera: (publish: boolean) => Promise<Result<void, string>>;
  kick: (targetUserId: number) => Promise<Result<void, string>>;
}

export type VoipStore = [VoipState, VoipActions];

function createVoipStore(): VoipStore {
  const [state, setState] = createStore<VoipState>({
    voipState: [],
  });

  const connection = useConnection();
  const [, authActions] = useAuth();
  const [, playbackActions] = usePlayback();
  const [, microphoneActions] = useMicrophone();
  const [, screenActions] = useScreenShare();
  const [, cameraActions] = useCamera();
  const [, soundActions] = useSound();
  let cleanupFn: (() => void) | null = null;

  const actions: VoipActions = {
    async init() {
      actions.cleanup();

      const result = await request<VoipParticipant[]>("/voip/participants", {
        method: "GET",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      cleanupFn = connection.onServerEvent(async (event) => {
        const myChannelId = actions.findById(authActions.getUser().userId)?.channelId;

        if (event.type === "voipParticipantCreated") {
          const participant = event.user as VoipParticipant;
          if (myChannelId && participant.channelId === myChannelId) {
            soundActions.play("/sounds/join.mp3");
          }
          actions.add(participant);
        } else if (event.type === "voipParticipantUpdated") {
          actions.update(event.user as VoipParticipant);
        } else if (event.type === "voipParticipantDeleted") {
          const participant = actions.findById(event.userId as number);
          if (myChannelId && participant?.channelId === myChannelId) {
            soundActions.play("/sounds/leave.mp3");
          }
          if (event.userId == authActions.getUser().userId) {
            await microphoneActions.stop()
            await screenActions.stop()
            await cameraActions.stop()
          }
          actions.remove(event.userId as number);
        }
      });

      return ok(undefined);
    },

    cleanup() {
      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }
      setState("voipState", []);
    },

    list() {
      return state.voipState;
    },

    findByChannel(channelId) {
      return state.voipState.filter((participant) => participant.channelId === channelId);
    },

    findById(userId) {
      return state.voipState.find((p) => p.userId === userId);
    },

    replaceAll(participants) {
      setState("voipState", participants);
    },

    add(participant) {
      setState("voipState", (voipState) => [...voipState, participant]);
    },

    update(participant) {
      setState("voipState", (voipState) =>
        voipState.map((p) => p.userId === participant.userId ? participant : p)
      );

      if (!participant.publishScreen) {
        playbackActions.destroyPlayback(participant.userId, "screen");
        playbackActions.destroyPlayback(participant.userId, "screenSound");
      }
      if (!participant.publishCamera) {
        playbackActions.destroyPlayback(participant.userId, "camera");
      }
    },

    remove(userId) {
      setState("voipState", (voipState) => voipState.filter((p) => p.userId !== userId));
      playbackActions.cleanupForUser(userId);
    },

    removeByChannel(channelId) {
      const participantsToRemove = state.voipState.filter((p) => p.channelId === channelId);
      for (const participant of participantsToRemove) {
        actions.remove(participant.userId);
      }
    },

    unpublishAll(userId) {
      setState("voipState", (voipState) => voipState.filter((p) => p.userId !== userId));
      playbackActions.cleanupForUser(userId);
    },

    async joinChannel(channelId, muted, deafened) {
      for (const participant of state.voipState) {
        playbackActions.cleanupForUser(participant.userId);
      }

      await request("/voip/leave", { method: "POST" });

      const result = await request(`/voip/channel/${channelId}/join/${muted}/${deafened}`, {
        method: "POST",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async joinPrivate(userId, muted, deafened) {
      for (const participant of state.voipState) {
        playbackActions.cleanupForUser(participant.userId);
      }

      await request("/voip/leave", { method: "POST" });

      const result = await request(`/voip/private/${userId}/join/${muted}/${deafened}`, {
        method: "POST",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async leave() {
      const result = await request("/voip/leave", { method: "POST" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async setMuted(muted) {
      const result = await request("/voip/mute", {
        method: "PUT",
        body: { mute: muted },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      soundActions.play("/sounds/mute.mp3");
      return ok(undefined);
    },

    async setDeafened(deafened) {
      const result = await request("/voip/deafen", {
        method: "PUT",
        body: { deafen: deafened },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      soundActions.play("/sounds/deafen.mp3");
      return ok(undefined);
    },

    async publishScreen(publish) {
      const result = await request("/voip/screen/publish", {
        method: "PUT",
        body: { publish },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async publishCamera(publish) {
      const result = await request("/voip/camera/publish", {
        method: "PUT",
        body: { publish },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async kick(targetUserId) {
      const result = await request(`/voip/kick/${targetUserId}`, {
        method: "POST",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: VoipStore | null = null;

export function useVoip(): VoipStore {
  if (!instance) {
    createRoot(() => {
      instance = createVoipStore();
    });
  }
  return instance!;
}
