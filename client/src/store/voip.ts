import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { VoipParticipant } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import type { CallType } from "./modal";
import { useAuth } from "./auth";
import { useSound } from "./sound";
import { getLiveKitManager, Track } from "../lib/livekit";

interface JoinVoipResponse {
    token: string;
    serverUrl: string;
}

interface VoipState {
    voipState: VoipParticipant[];
    currentCallType: CallType | null;
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
        currentCallType: null,
    });

    const connection = useConnection();
    const [, authActions] = useAuth();
    const [, soundActions] = useSound();
    const livekit = getLiveKitManager();
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
                        soundActions.play("/sounds/enter_call.ogg");
                    }
                    actions.add(participant);
                } else if (event.type === "voipParticipantUpdated") {
                    actions.update(event.user as VoipParticipant);
                } else if (event.type === "voipParticipantDeleted") {
                    const participant = actions.findById(event.userId as number);
                    if (myChannelId && participant?.channelId === myChannelId) {
                        soundActions.play("/sounds/leave_call.ogg");
                    }
                    if (event.userId == authActions.getUser().userId) {
                        await livekit.disconnect();
                        setState("currentCallType", null);
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
            setState("currentCallType", null);
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
                livekit.detachTrack(participant.userId, Track.Source.ScreenShare);
                livekit.detachTrack(participant.userId, Track.Source.ScreenShareAudio);
            }
            if (!participant.publishCamera) {
                livekit.detachTrack(participant.userId, Track.Source.Camera);
            }
        },

        remove(userId) {
            setState("voipState", (voipState) => voipState.filter((p) => p.userId !== userId));
            livekit.cleanupForUser(userId);
        },

        removeByChannel(channelId) {
            const participantsToRemove = state.voipState.filter((p) => p.channelId === channelId);
            for (const participant of participantsToRemove) {
                actions.remove(participant.userId);
            }
        },

        unpublishAll(userId) {
            setState("voipState", (voipState) => voipState.filter((p) => p.userId !== userId));
            livekit.cleanupForUser(userId);
        },

        async joinChannel(channelId, muted, deafened) {
            for (const participant of state.voipState) {
                livekit.cleanupForUser(participant.userId);
            }

            await livekit.disconnect();
            await request("/voip/leave", { method: "POST" });

            const result = await request<JoinVoipResponse>(`/voip/channel/${channelId}/join/${muted}/${deafened}`, {
                method: "POST",
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }

            const { token, serverUrl } = result.value;
            setState("currentCallType", "channel");

            await livekit.connect(serverUrl, token);

            livekit.setMuted(muted);
            await livekit.setMicEnabled(true);

            soundActions.play("/sounds/enter_call_me.ogg");
            return ok(undefined);
        },

        async joinPrivate(userId, muted, deafened) {
            for (const participant of state.voipState) {
                livekit.cleanupForUser(participant.userId);
            }

            await livekit.disconnect();
            await request("/voip/leave", { method: "POST" });

            const result = await request<JoinVoipResponse>(`/voip/private/${userId}/join/${muted}/${deafened}`, {
                method: "POST",
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }

            const { token, serverUrl } = result.value;
            setState("currentCallType", "private");

            await livekit.connect(serverUrl, token);

            livekit.setMuted(muted);
            await livekit.setMicEnabled(true);

            soundActions.play("/sounds/enter_call_me.ogg");
            return ok(undefined);
        },

        async leave() {
            await livekit.disconnect();
            setState("currentCallType", null);

            const result = await request("/voip/leave", { method: "POST" });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async setMuted(muted) {
            let inVoip = actions.findById(authActions.getUser().userId)
            if (inVoip) {
                const result = await request("/voip/mute", {
                    method: "PUT",
                    body: { mute: muted },
                });
                if (result.isErr()) {
                    return err(result.error.reason);
                }
            }

            await livekit.setMicMuted(muted);
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
            await livekit.setScreenShareEnabled(publish);
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
            await livekit.setCameraEnabled(publish);
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
