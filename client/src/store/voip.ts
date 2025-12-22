import { createStore, produce } from "solid-js/store";
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
        if (event.type === "voipParticipantUpdated") {
          actions.update(event.user as VoipParticipant);
        } else if (event.type === "voipParticipantDeleted") {
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
      const [, playbackActions] = usePlayback();
      for (const participant of participants) {
        playbackActions.initializeForUser(participant.userId);
      }
    },

    update(participant) {
      setState(
        "voipState",
        produce((voipState) => {
          const index = voipState.findIndex((p) => p.userId === participant.userId);
          if (index !== -1) {
            voipState[index] = participant;
          } else {
            voipState.push(participant);
          }
        })
      );
      const [, playbackActions] = usePlayback();
      playbackActions.initializeForUser(participant.userId);
    },

    remove(userId) {
      setState(
        "voipState",
        produce((voipState) => {
          const index = voipState.findIndex((p) => p.userId === userId);
          if (index !== -1) {
            voipState.splice(index, 1);
          }
        })
      );
      const [, playbackActions] = usePlayback();
      playbackActions.cleanupForUser(userId);
    },

    removeByChannel(channelId) {
      const participantsToRemove = state.voipState.filter((p) => p.channelId === channelId);
      for (const participant of participantsToRemove) {
        actions.remove(participant.userId);
      }
    },

    unpublishAll(userId) {
      setState(
        "voipState",
        produce((streams) => {
          for (let i = streams.length - 1; i >= 0; i--) {
            if (streams[i].userId === userId) {
              streams.splice(i, 1);
            }
          }
        })
      );
      playbackActions.cleanupForUser(userId);
    },

    async joinChannel(channelId, muted, deafened) {
      const result = await request(`/voip/channel/${channelId}/join/${muted}/${deafened}`, {
        method: "POST",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async joinPrivate(userId, muted, deafened) {
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
