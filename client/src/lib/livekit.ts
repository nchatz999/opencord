import {
    Room,
    RoomEvent,
    Track,
    ConnectionState,
    VideoPreset,
    type RemoteTrack,
    type RemoteTrackPublication,
    type RemoteParticipant,
    type RemoteAudioTrack,
    type Participant,
    type LocalTrack,
    type LocalTrackPublication,
} from "livekit-client";
import { createRoot, batch } from "solid-js";
import { createStore } from "solid-js/store";
import { usePreference } from "../store/preference";
import { NoiseSuppressorProcessor } from "rnnoise-wasm";
import workletUrl from "rnnoise-wasm/worklet-bundle?url";
import { useVoip, useAuth, useConnection } from "../store";

export { Track, VideoQuality } from "livekit-client";

export interface MediaDevice {
    deviceId: string;
    label: string;
}

export type CameraResolution = "720p" | "1080p";
export type ScreenResolution = "480p" | "720p" | "1080p" | "1440p" | "4k";
export type FrameRate = 30 | 60;

interface Option<T> {
    value: T;
    label: string;
}

const CAMERA_RESOLUTION = {
    "720p":  { width: 1280, height: 720,  bitrate: 2_000_000 },
    "1080p": { width: 1920, height: 1080, bitrate: 4_000_000 },
} as const;

const SCREEN_RESOLUTION = {
    "480p":  { width: 854,  height: 480,  bitrate: 2_500_000 },
    "720p":  { width: 1280, height: 720,  bitrate: 5_000_000 },
    "1080p": { width: 1920, height: 1080, bitrate: 10_000_000 },
    "1440p": { width: 2560, height: 1440, bitrate: 15_000_000 },
    "4k":    { width: 3840, height: 2160, bitrate: 25_000_000 },
} as const;

const CAMERA_RESOLUTION_OPTIONS: Option<CameraResolution>[] = [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
];

const SCREEN_RESOLUTION_OPTIONS: Option<ScreenResolution>[] = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "1440p", label: "1440p" },
    { value: "4k", label: "4K" },
];

const FRAME_RATE_OPTIONS: Option<FrameRate>[] = [
    { value: 30, label: "30 fps" },
    { value: 60, label: "60 fps" },
];

const SCREEN_CODEC_OPTIONS: Option<ScreenCodec>[] = [
    { value: "h264", label: "H.264" },
    { value: "vp9", label: "VP9" },
];

const SCREEN_CONTENT_HINT_OPTIONS: Option<ScreenContentHint>[] = [
    { value: "motion", label: "Motion (Gaming)" },
    { value: "detail", label: "Detail (Text)" },
];

const ALL_SOURCES = [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const DEFAULT_VOLUME = 100;

type TrackKey = `${number}:${Track.Source}`;
type AudioSource = Track.Source.Microphone | Track.Source.ScreenShareAudio;

interface AudioEntry {
    track: RemoteAudioTrack;
    volume: number;
}

interface PlaybackState {
    tracks: Record<TrackKey, RemoteTrack>;
    audio: Record<TrackKey, AudioEntry>;
    speaking: Record<number, boolean>;
}

type PublicationKey = `${number}-${Track.Source}`;

export type LiveKitConnectionState = "connecting" | "connected" | undefined;
export type ScreenCodec = "h264" | "vp9";
export type ScreenContentHint = "motion" | "detail";

interface LiveKitState {
    connectionState: LiveKitConnectionState;
    inputDevices: MediaDevice[];
    outputDevices: MediaDevice[];
    activeInput: string;
    activeOutput: string;
    cameraResolution: CameraResolution;
    cameraFps: FrameRate;
    screenResolution: ScreenResolution;
    screenFps: FrameRate;
    screenCodec: ScreenCodec;
    screenContentHint: ScreenContentHint;
    muted: boolean;
    deafened: boolean;
    noiseCancellation: boolean;
}

interface LiveKitActions {
    prepareConnection: (serverUrl: string, token: string) => Promise<void>;
    connect: (serverUrl: string, token: string) => Promise<void>;
    disconnect: () => Promise<void>;
    getConnectionState: () => ConnectionState | null;
    isConnected: () => boolean;
    subscribeToCameraStream: (userId: number) => void;
    unsubscribeFromCameraStream: (userId: number) => void;
    subscribeToScreenStream: (userId: number) => void;
    unsubscribeFromScreenStream: (userId: number) => void;
    setMicEnabled: (enabled: boolean) => Promise<void>;
    setCameraEnabled: (enabled: boolean) => Promise<void>;
    setScreenShareEnabled: (enabled: boolean) => Promise<void>;
    detachTrack: (userId: number, source: Track.Source) => void;
    getTrack: (userId: number, source: Track.Source) => RemoteTrack | undefined;
    isSubscribedToVideo: (userId: number, source: Track.Source.Camera | Track.Source.ScreenShare) => boolean;
    cleanupForUser: (userId: number) => void;
    getSpeakingState: (userId: number) => boolean;
    setSpeakingState: (userId: number, speaking: boolean) => void;
    setVolume: (userId: number, volume: number) => void;
    getVolume: (userId: number) => number;
    setScreenVolume: (userId: number, volume: number) => void;
    getScreenVolume: (userId: number) => number | undefined;
    getCameraResolution: () => CameraResolution;
    setCameraResolution: (resolution: CameraResolution) => void;
    getCameraResolutionOptions: () => Option<CameraResolution>[];
    getCameraFps: () => FrameRate;
    setCameraFps: (fps: FrameRate) => void;
    getScreenResolution: () => ScreenResolution;
    setScreenResolution: (resolution: ScreenResolution) => void;
    getScreenResolutionOptions: () => Option<ScreenResolution>[];
    getScreenFps: () => FrameRate;
    setScreenFps: (fps: FrameRate) => void;
    getFpsOptions: () => Option<FrameRate>[];
    getScreenCodec: () => ScreenCodec;
    setScreenCodec: (codec: ScreenCodec) => void;
    getScreenCodecOptions: () => Option<ScreenCodec>[];
    getScreenContentHint: () => ScreenContentHint;
    setScreenContentHint: (hint: ScreenContentHint) => void;
    getScreenContentHintOptions: () => Option<ScreenContentHint>[];
    getMuted: () => boolean;
    setMuted: (muted: boolean) => Promise<void>;
    getDeafened: () => boolean;
    setDeafened: (deafened: boolean) => void;
    getNoiseCancellation: () => boolean;
    setNoiseCancellation: (enabled: boolean) => void;
    refreshDevices: () => Promise<void>;
    getAudioInputDevices: () => MediaDevice[];
    getAudioOutputDevices: () => MediaDevice[];
    getActiveAudioInput: () => string;
    getActiveAudioOutput: () => string;
    setAudioInputDevice: (deviceId: string) => Promise<void>;
    setAudioOutputDevice: (deviceId: string) => Promise<void>;
}

export type LiveKitStore = [LiveKitState, LiveKitActions];

function createLiveKitStore(): LiveKitStore {
    const [, prefActions] = usePreference();

    const [state, setState] = createStore<LiveKitState>({
        connectionState: undefined,
        inputDevices: [],
        outputDevices: [],
        activeInput: "",
        activeOutput: "",
        cameraResolution: prefActions.get<CameraResolution>("cameraResolution") ?? "1080p",
        cameraFps: prefActions.get<FrameRate>("cameraFps") ?? 30,
        screenResolution: prefActions.get<ScreenResolution>("screenResolution") ?? "1080p",
        screenFps: prefActions.get<FrameRate>("screenFps") ?? 60,
        screenCodec: prefActions.get<ScreenCodec>("screenCodec") ?? "vp9",
        screenContentHint: prefActions.get<ScreenContentHint>("screenContentHint") ?? "motion",
        muted: false,
        deafened: false,
        noiseCancellation: true,
    });

    const [playback, setPlayback] = createStore<PlaybackState>({
        tracks: {},
        audio: {},
        speaking: {},
    });

    const publications = new Map<PublicationKey, RemoteTrackPublication>();
    const noiseProcessor = new NoiseSuppressorProcessor(workletUrl);

    const createRoom = (): Room => {
        return new Room({
            adaptiveStream: true,
            dynacast: true,
            webAudioMix: true,
            reconnectPolicy: { nextRetryDelayInMs: () => null },
            audioCaptureDefaults: {
                noiseSuppression: false,
                echoCancellation: true,
                autoGainControl: true,
            },
            publishDefaults: {
                videoCodec: "h264",
                red: false,
            },
        });
    };

    let room = createRoom();

    const parseUserId = (identity: string): number => parseInt(identity, 10);

    const toTrackKey = (userId: number, source: Track.Source): TrackKey => `${userId}:${source}`;

    const prefKey = (userId: number, source: AudioSource): string => `vol:${userId}:${source}`;

    const loadVolume = (userId: number, source: AudioSource): number =>
        prefActions.get<number>(prefKey(userId, source)) ?? DEFAULT_VOLUME;

    const applyTrackVolume = (entry: AudioEntry): void => {
        entry.track.setVolume(state.deafened ? 0 : entry.volume / 100);
    };

    const attachTrack = (userId: number, source: Track.Source, track: RemoteTrack): void => {
        const key = toTrackKey(userId, source);
        actions.detachTrack(userId, source);
        setPlayback("tracks", key, track);

        if (source === Track.Source.Microphone || source === Track.Source.ScreenShareAudio) {
            const audioTrack = track as RemoteAudioTrack;
            const volume = loadVolume(userId, source);
            const entry = { track: audioTrack, volume };
            audioTrack.attach();
            applyTrackVolume(entry);
            setPlayback("audio", key, entry);
        }
    };

    const makePublicationKey = (participant: RemoteParticipant, source: Track.Source): PublicationKey =>
        `${parseUserId(participant.identity)}-${source}`;

    const storePublication = (participant: RemoteParticipant, publication: RemoteTrackPublication): void => {
        const key = makePublicationKey(participant, publication.source);
        publications.set(key, publication);

        if (publication.source === Track.Source.Microphone) {
            publication.setSubscribed(true);
        }
    };

    const removePublication = (participant: RemoteParticipant, publication: RemoteTrackPublication): void => {
        const key = makePublicationKey(participant, publication.source);
        publications.delete(key);
    };

    const syncRemotePublications = (): void => {
        for (const participant of room.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) {
                storePublication(participant, publication);
            }
        }
    };

    const setSubscription = (userId: number, source: Track.Source, subscribed: boolean): void => {
        const key: PublicationKey = `${userId}-${source}`;
        publications.get(key)?.setSubscribed(subscribed);
    };

    const getMicrophoneTrack = (): LocalTrack | undefined =>
        room?.localParticipant?.getTrackPublication(Track.Source.Microphone)?.track as LocalTrack | undefined;

    const applyNoiseProcessor = async (track: LocalTrack): Promise<void> => {
        await track.setProcessor(noiseProcessor);
        noiseProcessor.enabled = state.noiseCancellation;
        noiseProcessor.setVad((speaking) => {
            const [, authActions] = useAuth();
            const connection = useConnection();
            connection.sendSpeakStatus(authActions.getUser().userId, speaking);
        });
    };

    const syncMicrophoneState = async (): Promise<void> => {
        const track = getMicrophoneTrack();
        if (!track) return;

        if (state.muted) {
            noiseProcessor.setVad(() => { });
            await track.stopProcessor();
            await track.mute();
        } else {
            await track.unmute();
            await applyNoiseProcessor(track);
        }
    };

    const restoreDevicePreferences = async (): Promise<void> => {
        const input = state.activeInput;
        const output = state.activeOutput;
        if (input) await room.switchActiveDevice("audioinput", input).catch(() => { });
        if (output) await room.switchActiveDevice("audiooutput", output).catch(() => { });
    };

    const updateVolume = (userId: number, source: AudioSource, volume: number): void => {
        const key = toTrackKey(userId, source);
        const entry = playback.audio[key];
        if (entry) {
            prefActions.set(prefKey(userId, source), volume);
            setPlayback("audio", key, { ...entry, volume });
            applyTrackVolume({ ...entry, volume });
        }
    };

    const handleTrackSubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        const userId = parseUserId(participant.identity);
        attachTrack(userId, track.source, track);
    };

    const handleTrackUnsubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        const userId = parseUserId(participant.identity);
        actions.detachTrack(userId, track.source);
    };

    const handleTrackPublished = (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        storePublication(participant, publication);
    };

    const handleTrackUnpublished = (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        removePublication(participant, publication);
    };

    const handleLocalTrackUnpublished = (publication: LocalTrackPublication): void => {
        const [, voipActions] = useVoip();
        if (publication.source === Track.Source.ScreenShare) {
            voipActions.publishScreen(false);
        }
    };

    const handlePermissionsChanged = async (_: unknown, participant: Participant): Promise<void> => {
        if (participant === room.localParticipant && participant.permissions?.canPublish) {
            await room.localParticipant.setMicrophoneEnabled(true);
            await syncMicrophoneState();
        }
    };

    const setupEventListeners = (): void => {
        room
            .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
            .on(RoomEvent.TrackPublished, handleTrackPublished)
            .on(RoomEvent.TrackUnpublished, handleTrackUnpublished)
            .on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
            .on(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
    };

    setupEventListeners();

    const actions: LiveKitActions = {
        async prepareConnection(serverUrl, token) {
            await room.prepareConnection(serverUrl, token);
        },

        async connect(serverUrl, token) {
            await actions.disconnect();
            setState("connectionState", "connecting");
            await room.connect(serverUrl, token, { autoSubscribe: false });
            syncRemotePublications();
            setState("connectionState", "connected");
            await restoreDevicePreferences();
            await actions.setMicEnabled(true);
        },

        async disconnect() {
            for (const key of Object.keys(playback.audio) as TrackKey[]) {
                playback.audio[key]?.track.detach();
            }
            for (const key of Object.keys(playback.tracks) as TrackKey[]) {
                playback.tracks[key]?.detach();
            }
            setPlayback({ tracks: {}, audio: {}, speaking: {} });
            publications.clear();
            await room.disconnect();
            setState("connectionState", undefined);
        },

        getConnectionState() {
            return room?.state ?? null;
        },

        isConnected() {
            return room?.state === ConnectionState.Connected;
        },

        subscribeToCameraStream(userId) {
            setSubscription(userId, Track.Source.Camera, true);
        },

        unsubscribeFromCameraStream(userId) {
            setSubscription(userId, Track.Source.Camera, false);
        },

        subscribeToScreenStream(userId) {
            setSubscription(userId, Track.Source.ScreenShare, true);
            setSubscription(userId, Track.Source.ScreenShareAudio, true);
        },

        unsubscribeFromScreenStream(userId) {
            setSubscription(userId, Track.Source.ScreenShare, false);
            setSubscription(userId, Track.Source.ScreenShareAudio, false);
        },

        async setMicEnabled(enabled) {
            if (!room?.localParticipant) return;
            await room.localParticipant.setMicrophoneEnabled(enabled);
            if (enabled) await syncMicrophoneState();
        },

        async setCameraEnabled(enabled) {
            if (!room?.localParticipant) return;

            if (enabled) {
                const res = CAMERA_RESOLUTION[state.cameraResolution];
                const fps = state.cameraFps;
                const bitrate = fps === 60 ? res.bitrate * 1.5 : res.bitrate;

                await room.localParticipant.setCameraEnabled(true, {
                    resolution: { width: res.width, height: res.height, frameRate: fps },
                }, {
                    videoEncoding: { maxBitrate: bitrate, maxFramerate: fps },
                    videoSimulcastLayers: [
                        new VideoPreset(res.width / 4, res.height / 4, bitrate / 8, Math.min(fps, 15)),
                        new VideoPreset(res.width / 2, res.height / 2, bitrate / 4, Math.min(fps, 30)),
                    ],
                });
            } else {
                await room.localParticipant.setCameraEnabled(false);
            }
        },

        async setScreenShareEnabled(enabled) {
            if (!room?.localParticipant) return;

            if (enabled) {
                const res = SCREEN_RESOLUTION[state.screenResolution];
                const fps = state.screenFps;
                const bitrate = fps === 60 ? res.bitrate * 1.5 : res.bitrate;

                await room.localParticipant.setScreenShareEnabled(true, {
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        channelCount: 2,
                    },
                    resolution: { width: res.width, height: res.height, frameRate: fps },
                    contentHint: state.screenContentHint,
                }, {
                    videoCodec: state.screenCodec,
                    screenShareEncoding: { maxBitrate: bitrate, maxFramerate: fps },
                    screenShareSimulcastLayers: [
                        new VideoPreset(res.width / 4, res.height / 4, bitrate / 8, Math.min(fps, 15)),
                        new VideoPreset(res.width / 2, res.height / 2, bitrate / 4, Math.min(fps, 30)),
                    ],
                    degradationPreference: "maintain-framerate",
                });
            } else {
                await room.localParticipant.setScreenShareEnabled(false);
            }
        },

        detachTrack(userId, source) {
            const key = toTrackKey(userId, source);
            playback.audio[key]?.track.detach();
            playback.tracks[key]?.detach();
            setPlayback("tracks", key, undefined!);
            setPlayback("audio", key, undefined!);
        },

        getTrack(userId, source) {
            return playback.tracks[toTrackKey(userId, source)];
        },

        isSubscribedToVideo(userId, source) {
            return !!playback.tracks[toTrackKey(userId, source)];
        },

        cleanupForUser(userId) {
            ALL_SOURCES.forEach((s) => actions.detachTrack(userId, s));
            setPlayback("speaking", userId, undefined!);
        },

        getSpeakingState(userId) {
            return playback.speaking[userId] ?? false;
        },

        setSpeakingState(userId, speaking) {
            setPlayback("speaking", userId, speaking);
        },

        setVolume(userId, volume) {
            updateVolume(userId, Track.Source.Microphone, volume);
        },

        getVolume(userId) {
            return playback.audio[toTrackKey(userId, Track.Source.Microphone)]?.volume
                ?? loadVolume(userId, Track.Source.Microphone);
        },

        setScreenVolume(userId, volume) {
            updateVolume(userId, Track.Source.ScreenShareAudio, volume);
        },

        getScreenVolume(userId) {
            return playback.audio[toTrackKey(userId, Track.Source.ScreenShareAudio)]?.volume;
        },

        getCameraResolution: () => state.cameraResolution,
        setCameraResolution: (resolution) => { setState("cameraResolution", resolution); prefActions.set("cameraResolution", resolution); },
        getCameraResolutionOptions: () => CAMERA_RESOLUTION_OPTIONS,

        getCameraFps: () => state.cameraFps,
        setCameraFps: (fps) => { setState("cameraFps", fps); prefActions.set("cameraFps", fps); },

        getScreenResolution: () => state.screenResolution,
        setScreenResolution: (resolution) => { setState("screenResolution", resolution); prefActions.set("screenResolution", resolution); },
        getScreenResolutionOptions: () => SCREEN_RESOLUTION_OPTIONS,

        getScreenFps: () => state.screenFps,
        setScreenFps: (fps) => { setState("screenFps", fps); prefActions.set("screenFps", fps); },

        getFpsOptions: () => FRAME_RATE_OPTIONS,

        getScreenCodec: () => state.screenCodec,
        setScreenCodec: (codec) => { setState("screenCodec", codec); prefActions.set("screenCodec", codec); },
        getScreenCodecOptions: () => SCREEN_CODEC_OPTIONS,

        getScreenContentHint: () => state.screenContentHint,
        setScreenContentHint: (hint) => { setState("screenContentHint", hint); prefActions.set("screenContentHint", hint); },
        getScreenContentHintOptions: () => SCREEN_CONTENT_HINT_OPTIONS,

        getMuted: () => state.muted,
        async setMuted(muted) { setState("muted", muted); await syncMicrophoneState(); },

        getDeafened: () => state.deafened,
        setDeafened(deafened) {
            setState("deafened", deafened);
            for (const entry of Object.values(playback.audio)) {
                if (entry) applyTrackVolume(entry);
            }
        },

        getNoiseCancellation: () => state.noiseCancellation,
        setNoiseCancellation(enabled) {
            setState("noiseCancellation", enabled);
            noiseProcessor.enabled = enabled;
        },

        async refreshDevices() {
            const [inputs, outputs] = await Promise.all([
                Room.getLocalDevices("audioinput"),
                Room.getLocalDevices("audiooutput"),
            ]);

            batch(() => {
                setState("inputDevices", inputs.map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
                })));
                setState("outputDevices", outputs.map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
                })));
                const inputId = room?.getActiveDevice("audioinput") || inputs[0]?.deviceId;
                const outputId = room?.getActiveDevice("audiooutput") || outputs[0]?.deviceId;
                if (inputId && inputId !== "default") setState("activeInput", inputId);
                if (outputId && outputId !== "default") setState("activeOutput", outputId);
            });
        },

        getAudioInputDevices: () => state.inputDevices,
        getAudioOutputDevices: () => state.outputDevices,
        getActiveAudioInput: () => state.activeInput,
        getActiveAudioOutput: () => state.activeOutput,

        async setAudioInputDevice(deviceId) {
            setState("activeInput", deviceId);

            const track = getMicrophoneTrack();
            if (track) {
                await track.stopProcessor();
            }

            await room?.switchActiveDevice("audioinput", deviceId);

            const newTrack = getMicrophoneTrack();
            if (newTrack && !state.muted) {
                await applyNoiseProcessor(newTrack);
            }
        },

        async setAudioOutputDevice(deviceId) {
            setState("activeOutput", deviceId);
            await room?.switchActiveDevice("audiooutput", deviceId).catch(() => { });
        },
    };

    return [state, actions];
}

let instance: LiveKitStore | null = null;

export function useLiveKit(): LiveKitStore {
    if (!instance) {
        createRoot(() => {
            instance = createLiveKitStore();
        });
        navigator.mediaDevices.addEventListener("devicechange", () => instance?.[1].refreshDevices());
    }
    return instance!;
}
