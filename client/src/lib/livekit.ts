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
} from "livekit-client";
import { createSignal, createRoot, batch } from "solid-js";
import { createStore } from "solid-js/store";
import { usePreference } from "../store/preference";
import { NoiseSuppressorProcessor } from "rnnoise-wasm";
import workletUrl from "rnnoise-wasm/worklet-bundle?url";

export { Track } from "livekit-client";

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
    "480p30": new VideoPreset(854, 480, 1_000_000, 30),
    "480p60": new VideoPreset(854, 480, 1_500_000, 60),
    "720p30": new VideoPreset(1280, 720, 1_500_000, 30),
    "720p60": new VideoPreset(1280, 720, 2_500_000, 60),
    "1080p30": new VideoPreset(1920, 1080, 3_000_000, 30),
    "1080p60": new VideoPreset(1920, 1080, 5_000_000, 60),
    "1440p30": new VideoPreset(2560, 1440, 5_000_000, 30),
    "1440p60": new VideoPreset(2560, 1440, 8_000_000, 60),
    "4k30": new VideoPreset(3840, 2160, 8_000_000, 30),
    "4k60": new VideoPreset(3840, 2160, 12_000_000, 60),
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

export class LiveKitManager {
    private room: Room;
    private publications = new Map<PublicationKey, RemoteTrackPublication>();
    private noiseProcessor: NoiseSuppressorProcessor;

    private playback: PlaybackState;
    private setPlayback: ReturnType<typeof createStore<PlaybackState>>[1];
    private pref: ReturnType<typeof usePreference>[1];

    private inputDevices: () => MediaDevice[];
    private setInputDevices: (d: MediaDevice[]) => void;
    private outputDevices: () => MediaDevice[];
    private setOutputDevices: (d: MediaDevice[]) => void;
    private activeInput: () => string;
    private setActiveInput: (id: string) => void;
    private activeOutput: () => string;
    private setActiveOutput: (id: string) => void;
    private cameraQuality: () => CameraQuality;
    private setCameraQualitySignal: (q: CameraQuality) => void;
    private screenQuality: () => ScreenQuality;
    private setScreenQualitySignal: (q: ScreenQuality) => void;
    private muted: () => boolean;
    private setMutedSignal: (m: boolean) => void;
    private deafened: () => boolean;
    private setDeafenedSignal: (d: boolean) => void;
    private noiseCancellation: () => boolean;
    private setNoiseCancellationSignal: (n: boolean) => void;

    constructor() {
        [this.inputDevices, this.setInputDevices] = createSignal<MediaDevice[]>([]);
        [this.outputDevices, this.setOutputDevices] = createSignal<MediaDevice[]>([]);
        [this.activeInput, this.setActiveInput] = createSignal("");
        [this.activeOutput, this.setActiveOutput] = createSignal("");
        [this.cameraQuality, this.setCameraQualitySignal] = createSignal<CameraQuality>("1080p30");
        [this.screenQuality, this.setScreenQualitySignal] = createSignal<ScreenQuality>("1080p30");
        [this.muted, this.setMutedSignal] = createSignal(false);
        [this.deafened, this.setDeafenedSignal] = createSignal(false);
        [this.noiseCancellation, this.setNoiseCancellationSignal] = createSignal(true);

        [this.playback, this.setPlayback] = createStore<PlaybackState>({
            tracks: {},
            audio: {},
            speaking: {},
        });
        this.pref = usePreference()[1];

        this.noiseProcessor = new NoiseSuppressorProcessor(workletUrl);
        this.room = this.createRoom();
        this.setupEventListeners();
    }

    private createRoom(): Room {
        const preset = CAMERA_PRESETS[this.cameraQuality()];

        return new Room({
            adaptiveStream: true,
            dynacast: true,
            webAudioMix: true,
            audioCaptureDefaults: {
                noiseSuppression: false,
                echoCancellation: true,
                autoGainControl: true,
            },
            videoCaptureDefaults: {
                resolution: {
                    width: preset.width,
                    height: preset.height,
                    frameRate: preset.encoding.maxFramerate,
                },
            },
            publishDefaults: {
                videoEncoding: preset.encoding,
                videoSimulcastLayers: getSimulcastLayers(preset),
            },
        });
    }

    async prepareConnection(serverUrl: string, token: string): Promise<void> {
        await this.room.prepareConnection(serverUrl, token);
    }

    async connect(serverUrl: string, token: string): Promise<void> {
        await this.disconnect();
        await this.room.connect(serverUrl, token, { autoSubscribe: false });
        this.syncRemotePublications();
        await this.restoreDevicePreferences();
    }

    async disconnect(): Promise<void> {
        await this.room.disconnect();
        this.publications.clear();
    }

    getConnectionState(): ConnectionState | null {
        return this.room?.state ?? null;
    }

    isConnected(): boolean {
        return this.room?.state === ConnectionState.Connected;
    }

    private setupEventListeners(): void {
        this.room
            .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
            .on(RoomEvent.TrackUnsubscribed, this.handleTrackUnsubscribed)
            .on(RoomEvent.TrackPublished, this.handleTrackPublished)
            .on(RoomEvent.TrackUnpublished, this.handleTrackUnpublished)
            .on(RoomEvent.ActiveSpeakersChanged, this.handleActiveSpeakersChanged)
            .on(RoomEvent.ParticipantPermissionsChanged, this.handlePermissionsChanged);
    }

    private handleTrackSubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        const userId = this.parseUserId(participant.identity);
        this.attachTrack(userId, track.source, track);
    };

    private handleTrackUnsubscribed = (
        track: RemoteTrack,
        _pub: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        const userId = this.parseUserId(participant.identity);
        this.detachTrack(userId, track.source);
    };

    private handleTrackPublished = (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        this.storePublication(participant, publication);
    };

    private handleTrackUnpublished = (
        publication: RemoteTrackPublication,
        participant: RemoteParticipant
    ): void => {
        this.removePublication(participant, publication);
    };

    private handleActiveSpeakersChanged = (speakers: Participant[]): void => {
        const speakingIds = new Set(speakers.map((s) => this.parseUserId(s.identity)));
        for (const participant of this.room.remoteParticipants.values()) {
            const userId = this.parseUserId(participant.identity);
            this.setPlayback("speaking", userId, speakingIds.has(userId));
        }
    };

    private handlePermissionsChanged = async (_: unknown, participant: Participant): Promise<void> => {
        if (participant === this.room.localParticipant && participant.permissions?.canPublish) {
            await this.enableMicrophone();
        }
    };

    private syncRemotePublications(): void {
        for (const participant of this.room.remoteParticipants.values()) {
            for (const publication of participant.trackPublications.values()) {
                this.storePublication(participant, publication);
            }
        }
    }

    private storePublication(participant: RemoteParticipant, publication: RemoteTrackPublication): void {
        const key = this.makePublicationKey(participant, publication.source);
        this.publications.set(key, publication);

        if (publication.source === Track.Source.Microphone) {
            publication.setSubscribed(true);
        }
    }

    private removePublication(participant: RemoteParticipant, publication: RemoteTrackPublication): void {
        const key = this.makePublicationKey(participant, publication.source);
        this.publications.delete(key);
    }

    private makePublicationKey(participant: RemoteParticipant, source: Track.Source): PublicationKey {
        return `${this.parseUserId(participant.identity)}-${source}`;
    }

    private parseUserId(identity: string): number {
        return parseInt(identity, 10);
    }

    subscribeToCameraStream(userId: number): void {
        this.setSubscription(userId, Track.Source.Camera, true);
    }

    unsubscribeFromCameraStream(userId: number): void {
        this.setSubscription(userId, Track.Source.Camera, false);
    }

    subscribeToScreenStream(userId: number): void {
        this.setSubscription(userId, Track.Source.ScreenShare, true);
        this.setSubscription(userId, Track.Source.ScreenShareAudio, true);
    }

    unsubscribeFromScreenStream(userId: number): void {
        this.setSubscription(userId, Track.Source.ScreenShare, false);
        this.setSubscription(userId, Track.Source.ScreenShareAudio, false);
    }

    private setSubscription(userId: number, source: Track.Source, subscribed: boolean): void {
        const key: PublicationKey = `${userId}-${source}`;
        this.publications.get(key)?.setSubscribed(subscribed);
    }

    private async enableMicrophone(): Promise<void> {
        const localParticipant = this.room?.localParticipant;
        if (!localParticipant) return;

        await localParticipant.setMicrophoneEnabled(true);
        await this.syncMicrophoneState();
    }

    async setMicEnabled(enabled: boolean): Promise<void> {
        const localParticipant = this.room?.localParticipant;
        if (!localParticipant) return;

        if (enabled) {
            await this.enableMicrophone();
        } else {
            await localParticipant.setMicrophoneEnabled(false);
        }
    }

    async setMicMuted(muted: boolean): Promise<void> {
        this.setMutedSignal(muted);
        await this.syncMicrophoneState();
    }

    private async syncMicrophoneState(): Promise<void> {
        const track = this.getMicrophoneTrack();
        if (!track) return;

        if (this.muted()) {
            await track.stopProcessor();
            await track.mute();
        } else {
            await track.unmute();
            await this.applyNoiseProcessor(track);
        }
    }

    private async applyNoiseProcessor(track: LocalTrack): Promise<void> {
        await track.setProcessor(this.noiseProcessor);
        this.noiseProcessor.enabled = this.noiseCancellation();
    }

    private getMicrophoneTrack(): LocalTrack | undefined {
        return this.room?.localParticipant
            ?.getTrackPublication(Track.Source.Microphone)
            ?.track as LocalTrack | undefined;
    }

    async setCameraEnabled(enabled: boolean): Promise<void> {
        await this.room?.localParticipant?.setCameraEnabled(enabled);
    }

    async setScreenShareEnabled(enabled: boolean): Promise<void> {
        if (!this.room?.localParticipant) return;

        if (enabled) {
            const preset = SCREEN_PRESETS[this.screenQuality()];
            await this.room.localParticipant.setScreenShareEnabled(true, {
                audio: true,
                resolution: { width: preset.width, height: preset.height, frameRate: preset.encoding.maxFramerate },
            });
        } else {
            await this.room.localParticipant.setScreenShareEnabled(false);
        }
    }

    private toTrackKey(userId: number, source: Track.Source): TrackKey {
        return `${userId}:${source}`;
    }

    private prefKey(userId: number, source: AudioSource): string {
        return `vol:${userId}:${source}`;
    }

    private loadVolume(userId: number, source: AudioSource): number {
        return this.pref.get<number>(this.prefKey(userId, source)) ?? DEFAULT_VOLUME;
    }

    private applyTrackVolume(entry: AudioEntry): void {
        entry.track.setVolume(this.deafened() ? 0 : entry.volume / 100);
    }

    private attachTrack(userId: number, source: Track.Source, track: RemoteTrack): void {
        const key = this.toTrackKey(userId, source);
        this.detachTrack(userId, source);
        this.setPlayback("tracks", key, track);

        if (source === Track.Source.Microphone || source === Track.Source.ScreenShareAudio) {
            const audioTrack = track as RemoteAudioTrack;
            const volume = this.loadVolume(userId, source);
            const entry = { track: audioTrack, volume };
            this.applyTrackVolume(entry);
            audioTrack.attach();
            this.setPlayback("audio", key, entry);
        }
    }

    detachTrack(userId: number, source: Track.Source): void {
        const key = this.toTrackKey(userId, source);
        this.playback.audio[key]?.track.detach();
        this.playback.tracks[key]?.detach();
        this.setPlayback("tracks", key, undefined!);
        this.setPlayback("audio", key, undefined!);
    }

    getTrack(userId: number, source: Track.Source): RemoteTrack | undefined {
        return this.playback.tracks[this.toTrackKey(userId, source)];
    }

    isSubscribedToVideo(userId: number, source: Track.Source.Camera | Track.Source.ScreenShare): boolean {
        return !!this.playback.tracks[this.toTrackKey(userId, source)];
    }

    cleanupForUser(userId: number): void {
        ALL_SOURCES.forEach((s) => this.detachTrack(userId, s));
        this.setPlayback("speaking", userId, undefined!);
    }

    getSpeakingState(userId: number): boolean {
        return this.playback.speaking[userId] ?? false;
    }

    setVolume(userId: number, volume: number): void {
        this.updateVolume(userId, Track.Source.Microphone, volume);
    }

    getVolume(userId: number): number {
        return this.playback.audio[this.toTrackKey(userId, Track.Source.Microphone)]?.volume ?? DEFAULT_VOLUME;
    }

    setScreenVolume(userId: number, volume: number): void {
        this.updateVolume(userId, Track.Source.ScreenShareAudio, volume);
    }

    getScreenVolume(userId: number): number | undefined {
        return this.playback.audio[this.toTrackKey(userId, Track.Source.ScreenShareAudio)]?.volume;
    }

    private updateVolume(userId: number, source: AudioSource, volume: number): void {
        const key = this.toTrackKey(userId, source);
        const entry = this.playback.audio[key];
        if (entry) {
            this.pref.set(this.prefKey(userId, source), volume);
            this.setPlayback("audio", key, { ...entry, volume });
            this.applyTrackVolume({ ...entry, volume });
        }
    }

    getCameraQuality = () => this.cameraQuality();
    setCameraQuality = (quality: CameraQuality) => this.setCameraQualitySignal(quality);
    getCameraQualityOptions = () => CAMERA_QUALITY_OPTIONS;

    getScreenQuality = () => this.screenQuality();
    setScreenQuality = (quality: ScreenQuality) => this.setScreenQualitySignal(quality);
    getScreenQualityOptions = () => SCREEN_QUALITY_OPTIONS;

    getMuted = () => this.muted();
    setMuted = (muted: boolean) => this.setMicMuted(muted);

    getDeafened = () => this.deafened();
    setDeafened = (deafened: boolean): void => {
        this.setDeafenedSignal(deafened);
        for (const entry of Object.values(this.playback.audio)) {
            if (entry) this.applyTrackVolume(entry);
        }
    };

    getNoiseCancellation = () => this.noiseCancellation();
    setNoiseCancellation = (enabled: boolean): void => {
        this.setNoiseCancellationSignal(enabled);
        this.noiseProcessor.enabled = enabled;
    };

    async refreshDevices(): Promise<void> {
        const [inputs, outputs] = await Promise.all([
            Room.getLocalDevices("audioinput"),
            Room.getLocalDevices("audiooutput"),
        ]);

        batch(() => {
            this.setInputDevices(
                inputs.map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
                }))
            );
            this.setOutputDevices(
                outputs.map((d) => ({
                    deviceId: d.deviceId,
                    label: d.label || `Speaker ${d.deviceId.slice(0, 8)}`,
                }))
            );
            this.setActiveInput(this.room?.getActiveDevice("audioinput") ?? inputs[0]?.deviceId ?? "");
            this.setActiveOutput(this.room?.getActiveDevice("audiooutput") ?? outputs[0]?.deviceId ?? "");
        });
    }

    private async restoreDevicePreferences(): Promise<void> {
        const input = this.activeInput();
        const output = this.activeOutput();
        if (input) await this.room.switchActiveDevice("audioinput", input);
        if (output) await this.room.switchActiveDevice("audiooutput", output);
    }

    getAudioInputDevices = () => this.inputDevices();
    getAudioOutputDevices = () => this.outputDevices();
    getActiveAudioInput = () => this.activeInput();
    getActiveAudioOutput = () => this.activeOutput();

    async setAudioInputDevice(deviceId: string): Promise<void> {
        this.setActiveInput(deviceId);

        const track = this.getMicrophoneTrack();
        if (track) {
            await track.stopProcessor();
        }

        await this.room?.switchActiveDevice("audioinput", deviceId);

        const newTrack = this.getMicrophoneTrack();
        if (newTrack && !this.muted()) {
            await this.applyNoiseProcessor(newTrack);
        }
    }

    async setAudioOutputDevice(deviceId: string): Promise<void> {
        this.setActiveOutput(deviceId);
        await this.room?.switchActiveDevice("audiooutput", deviceId);
    }
}

let instance: LiveKitManager | null = null;

export function getLiveKitManager(): LiveKitManager {
    if (!instance) {
        createRoot(() => {
            instance = new LiveKitManager();
        });
        navigator.mediaDevices.addEventListener("devicechange", () => instance?.refreshDevices());
    }
    return instance!;
}
