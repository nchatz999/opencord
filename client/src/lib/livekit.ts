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
import { useVoip } from "../store";

export { Track, VideoQuality } from "livekit-client";

export interface MediaDevice {
    deviceId: string;
    label: string;
}

export type CameraQuality = "720p30" | "720p60" | "1080p30" | "1080p60";
export type ScreenQuality = "480p30" | "480p60" | "720p30" | "720p60" | "1080p30" | "1080p60" | "1440p30" | "1440p60" | "4k30" | "4k60";

interface QualityOption<T> {
    value: T;
    label: string;
}

const CAMERA_PRESETS: Record<CameraQuality, VideoPreset> = {
    "720p30": new VideoPreset(1280, 720, 1_500_000, 30),
    "720p60": new VideoPreset(1280, 720, 2_500_000, 60),
    "1080p30": new VideoPreset(1920, 1080, 3_000_000, 30),
    "1080p60": new VideoPreset(1920, 1080, 5_000_000, 60),
};

const SCREEN_PRESETS: Record<ScreenQuality, VideoPreset> = {
    "480p30": new VideoPreset(854, 480, 2_000_000, 30),
    "480p60": new VideoPreset(854, 480, 3_000_000, 60),
    "720p30": new VideoPreset(1280, 720, 4_000_000, 30),
    "720p60": new VideoPreset(1280, 720, 6_000_000, 60),
    "1080p30": new VideoPreset(1920, 1080, 8_000_000, 30),
    "1080p60": new VideoPreset(1920, 1080, 12_000_000, 60),
    "1440p30": new VideoPreset(2560, 1440, 12_000_000, 30),
    "1440p60": new VideoPreset(2560, 1440, 18_000_000, 60),
    "4k30": new VideoPreset(3840, 2160, 20_000_000, 30),
    "4k60": new VideoPreset(3840, 2160, 30_000_000, 60),
};

const CAMERA_QUALITY_OPTIONS: QualityOption<CameraQuality>[] = [
    { value: "720p30", label: "720p 30fps" },
    { value: "720p60", label: "720p 60fps" },
    { value: "1080p30", label: "1080p 30fps" },
    { value: "1080p60", label: "1080p 60fps" },
];

const SCREEN_QUALITY_OPTIONS: QualityOption<ScreenQuality>[] = [
    { value: "480p30", label: "480p 30fps" },
    { value: "480p60", label: "480p 60fps" },
    { value: "720p30", label: "720p 30fps" },
    { value: "720p60", label: "720p 60fps" },
    { value: "1080p30", label: "1080p 30fps" },
    { value: "1080p60", label: "1080p 60fps" },
    { value: "1440p30", label: "1440p 30fps" },
    { value: "1440p60", label: "1440p 60fps" },
    { value: "4k30", label: "4K 30fps" },
    { value: "4k60", label: "4K 60fps" },
];

const SCREEN_CODEC_OPTIONS: QualityOption<ScreenCodec>[] = [
    { value: "h264", label: "H.264" },
    { value: "vp9", label: "VP9" },
];

const SCREEN_CONTENT_HINT_OPTIONS: QualityOption<ScreenContentHint>[] = [
    { value: "motion", label: "Motion (Gaming)" },
    { value: "detail", label: "Detail (Text)" },
];

const ALL_SOURCES = [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const DEFAULT_VOLUME = 100;

const getSimulcastLayers = (preset: VideoPreset): VideoPreset[] => [
    new VideoPreset(preset.width / 4, preset.height / 4, preset.encoding.maxBitrate / 6, 15),
    new VideoPreset(preset.width / 2, preset.height / 2, preset.encoding.maxBitrate / 3, 30),
];

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
    cameraQuality: CameraQuality;
    screenQuality: ScreenQuality;
    screenCodec: ScreenCodec;
    screenContentHint: ScreenContentHint;
    muted: boolean;
    deafened: boolean;
    noiseCancellation: boolean;
}

interface LiveKitActions {
    prepareConnection: (serverUrl: string, token: string) => Promise<void>;
    connect: (serverUrl: string, token: string, muted: boolean) => Promise<void>;
    disconnect: () => Promise<void>;
    getConnectionState: () => ConnectionState | null;
    isConnected: () => boolean;
    subscribeToCameraStream: (userId: number) => void;
    unsubscribeFromCameraStream: (userId: number) => void;
    subscribeToScreenStream: (userId: number) => void;
    unsubscribeFromScreenStream: (userId: number) => void;
    setMicEnabled: (enabled: boolean) => Promise<void>;
    setMicMuted: (muted: boolean) => Promise<void>;
    setCameraEnabled: (enabled: boolean) => Promise<void>;
    setScreenShareEnabled: (enabled: boolean) => Promise<void>;
    detachTrack: (userId: number, source: Track.Source) => void;
    getTrack: (userId: number, source: Track.Source) => RemoteTrack | undefined;
    isSubscribedToVideo: (userId: number, source: Track.Source.Camera | Track.Source.ScreenShare) => boolean;
    cleanupForUser: (userId: number) => void;
    getSpeakingState: (userId: number) => boolean;
    setVolume: (userId: number, volume: number) => void;
    getVolume: (userId: number) => number;
    setScreenVolume: (userId: number, volume: number) => void;
    getScreenVolume: (userId: number) => number | undefined;
    getCameraQuality: () => CameraQuality;
    setCameraQuality: (quality: CameraQuality) => void;
    getCameraQualityOptions: () => QualityOption<CameraQuality>[];
    getScreenQuality: () => ScreenQuality;
    setScreenQuality: (quality: ScreenQuality) => void;
    getScreenQualityOptions: () => QualityOption<ScreenQuality>[];
    getScreenCodec: () => ScreenCodec;
    setScreenCodec: (codec: ScreenCodec) => void;
    getScreenCodecOptions: () => QualityOption<ScreenCodec>[];
    getScreenContentHint: () => ScreenContentHint;
    setScreenContentHint: (hint: ScreenContentHint) => void;
    getScreenContentHintOptions: () => QualityOption<ScreenContentHint>[];
    getMuted: () => boolean;
    setMuted: (muted: boolean) => void;
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
    const [state, setState] = createStore<LiveKitState>({
        connectionState: undefined,
        inputDevices: [],
        outputDevices: [],
        activeInput: "",
        activeOutput: "",
        cameraQuality: "1080p30",
        screenQuality: "1080p30",
        screenCodec: "vp9",
        screenContentHint: "motion",
        muted: false,
        deafened: false,
        noiseCancellation: true,
    });

    const [playback, setPlayback] = createStore<PlaybackState>({
        tracks: {},
        audio: {},
        speaking: {},
    });

    const pref = usePreference()[1];
    const publications = new Map<PublicationKey, RemoteTrackPublication>();
    const noiseProcessor = new NoiseSuppressorProcessor(workletUrl);

    const createRoom = (): Room => {
        return new Room({
            adaptiveStream: true,
            dynacast: true,
            webAudioMix: true,
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
        pref.get<number>(prefKey(userId, source)) ?? DEFAULT_VOLUME;

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
    };

    const syncMicrophoneState = async (): Promise<void> => {
        const track = getMicrophoneTrack();
        if (!track) return;

        if (state.muted) {
            await track.stopProcessor();
            await track.mute();
        } else {
            await track.unmute();
            await applyNoiseProcessor(track);
        }
    };

    const enableMicrophone = async (): Promise<void> => {
        const localParticipant = room?.localParticipant;
        if (!localParticipant) return;

        await localParticipant.setMicrophoneEnabled(true);
        await syncMicrophoneState();
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
            pref.set(prefKey(userId, source), volume);
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

    const handleActiveSpeakersChanged = (speakers: Participant[]): void => {
        const speakingIds = new Set(speakers.map((s) => parseUserId(s.identity)));
        for (const participant of room.remoteParticipants.values()) {
            const userId = parseUserId(participant.identity);
            setPlayback("speaking", userId, speakingIds.has(userId));
        }
    };

    const handleLocalTrackUnpublished = (publication: LocalTrackPublication): void => {
        const [, voipActions] = useVoip();
        if (publication.source === Track.Source.ScreenShare) {
            voipActions.publishScreen(false);
        }
    };

    const handlePermissionsChanged = async (_: unknown, participant: Participant): Promise<void> => {
        if (participant === room.localParticipant && participant.permissions?.canPublish) {
            await enableMicrophone();
        }
    };

    const setupEventListeners = (): void => {
        room
            .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
            .on(RoomEvent.TrackPublished, handleTrackPublished)
            .on(RoomEvent.TrackUnpublished, handleTrackUnpublished)
            .on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
            .on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakersChanged)
            .on(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
    };

    setupEventListeners();

    const actions: LiveKitActions = {
        async prepareConnection(serverUrl, token) {
            await room.prepareConnection(serverUrl, token);
        },

        async connect(serverUrl, token, muted) {
            await actions.disconnect();
            setState("connectionState", "connecting");
            await room.connect(serverUrl, token, { autoSubscribe: false });
            syncRemotePublications();
            await restoreDevicePreferences();
            actions.setMuted(muted);
            await actions.setMicEnabled(true);
            setState("connectionState", "connected");
        },

        async disconnect() {
            await room.disconnect();
            publications.clear();
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
            const localParticipant = room?.localParticipant;
            if (!localParticipant) return;

            if (enabled) {
                await enableMicrophone();
            } else {
                await localParticipant.setMicrophoneEnabled(false);
            }
        },

        async setMicMuted(muted) {
            setState("muted", muted);
            await syncMicrophoneState();
        },

        async setCameraEnabled(enabled) {
            if (!room?.localParticipant) return;

            if (enabled) {
                const preset = CAMERA_PRESETS[state.cameraQuality];
                await room.localParticipant.setCameraEnabled(true, {
                    resolution: { width: preset.width, height: preset.height, frameRate: preset.encoding.maxFramerate },
                }, {
                    videoEncoding: preset.encoding,
                    videoSimulcastLayers: getSimulcastLayers(preset),
                });
            } else {
                await room.localParticipant.setCameraEnabled(false);
            }
        },

        async setScreenShareEnabled(enabled) {
            if (!room?.localParticipant) return;

            if (enabled) {
                const preset = SCREEN_PRESETS[state.screenQuality];
                await room.localParticipant.setScreenShareEnabled(true, {
                    audio: true,
                    resolution: { width: preset.width, height: preset.height, frameRate: preset.encoding.maxFramerate },
                    contentHint: state.screenContentHint,
                }, {
                    videoCodec: state.screenCodec,
                    screenShareEncoding: preset.encoding,
                    screenShareSimulcastLayers: getSimulcastLayers(preset),
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

        setVolume(userId, volume) {
            updateVolume(userId, Track.Source.Microphone, volume);
        },

        getVolume(userId) {
            return playback.audio[toTrackKey(userId, Track.Source.Microphone)]?.volume ?? DEFAULT_VOLUME;
        },

        setScreenVolume(userId, volume) {
            updateVolume(userId, Track.Source.ScreenShareAudio, volume);
        },

        getScreenVolume(userId) {
            return playback.audio[toTrackKey(userId, Track.Source.ScreenShareAudio)]?.volume;
        },

        getCameraQuality: () => state.cameraQuality,
        setCameraQuality: (quality) => setState("cameraQuality", quality),
        getCameraQualityOptions: () => CAMERA_QUALITY_OPTIONS,

        getScreenQuality: () => state.screenQuality,
        setScreenQuality: (quality) => setState("screenQuality", quality),
        getScreenQualityOptions: () => SCREEN_QUALITY_OPTIONS,

        getScreenCodec: () => state.screenCodec,
        setScreenCodec: (codec) => setState("screenCodec", codec),
        getScreenCodecOptions: () => SCREEN_CODEC_OPTIONS,

        getScreenContentHint: () => state.screenContentHint,
        setScreenContentHint: (hint) => setState("screenContentHint", hint),
        getScreenContentHintOptions: () => SCREEN_CONTENT_HINT_OPTIONS,

        getMuted: () => state.muted,
        setMuted: (muted) => actions.setMicMuted(muted),

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
                setState("activeInput", room?.getActiveDevice("audioinput") ?? inputs[0]?.deviceId ?? "");
                setState("activeOutput", room?.getActiveDevice("audiooutput") ?? outputs[0]?.deviceId ?? "");
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
