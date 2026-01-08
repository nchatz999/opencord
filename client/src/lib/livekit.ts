import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  ConnectionState,
  Participant,
  VideoPreset,
} from "livekit-client";
import { createSignal } from "solid-js";
import { usePlayback } from "../store/playback";
import { NoiseSuppressorProcessor } from "rnnoise-wasm";
import workletUrl from "rnnoise-wasm/worklet-bundle?url";

export { Track } from "livekit-client";

export interface MediaDevice {
  deviceId: string;
  label: string;
}

export type VideoQuality = "720p30" | "720p60" | "1080p30" | "1080p60" | "1440p30" | "1440p60" | "4k30" | "4k60";

const VIDEO_PRESETS: Record<VideoQuality, VideoPreset> = {
  "720p30": new VideoPreset(1280, 720, 1_500_000, 30),
  "720p60": new VideoPreset(1280, 720, 2_500_000, 60),
  "1080p30": new VideoPreset(1920, 1080, 3_000_000, 30),
  "1080p60": new VideoPreset(1920, 1080, 5_000_000, 60),
  "1440p30": new VideoPreset(2560, 1440, 5_000_000, 30),
  "1440p60": new VideoPreset(2560, 1440, 8_000_000, 60),
  "4k30": new VideoPreset(3840, 2160, 8_000_000, 30),
  "4k60": new VideoPreset(3840, 2160, 12_000_000, 60),
};

const getSimulcastLayers = (p: VideoPreset): VideoPreset[] => [
  new VideoPreset(p.width / 4, p.height / 4, p.encoding.maxBitrate / 6, 15),
  new VideoPreset(p.width / 2, p.height / 2, p.encoding.maxBitrate / 3, 30),
];

const VIDEO_QUALITY_OPTIONS = [
  { value: "720p30", label: "720p 30fps" },
  { value: "720p60", label: "720p 60fps" },
  { value: "1080p30", label: "1080p 30fps" },
  { value: "1080p60", label: "1080p 60fps" },
  { value: "1440p30", label: "1440p 30fps" },
  { value: "1440p60", label: "1440p 60fps" },
  { value: "4k30", label: "4K 30fps" },
  { value: "4k60", label: "4K 60fps" },
];


type PublicationKey = `${number}-${Track.Source}`;

const [inputDevices, setInputDevices] = createSignal<MediaDevice[]>([]);
const [outputDevices, setOutputDevices] = createSignal<MediaDevice[]>([]);
const [activeInput, setActiveInput] = createSignal<string>("");
const [activeOutput, setActiveOutput] = createSignal<string>("");
const [videoQuality, setVideoQuality] = createSignal<VideoQuality>("1080p30");
const [muted, setMuted] = createSignal<boolean>(true);
const [deafened, setDeafened] = createSignal<boolean>(false);
const [noiseCancellation, setNoiseCancellation] = createSignal<boolean>(true);
export class LiveKitManager {
  private room: Room;
  private publications = new Map<PublicationKey, RemoteTrackPublication>();
  private noiseProcessor = new NoiseSuppressorProcessor(workletUrl);

  constructor() {
    const preset = VIDEO_PRESETS[videoQuality()];
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: true,
      audioCaptureDefaults: {
        noiseSuppression: false,
        echoCancellation: true,
        autoGainControl: true,
      },
      videoCaptureDefaults: {
        resolution: { width: preset.width, height: preset.height, frameRate: preset.encoding.maxFramerate },
      },
      publishDefaults: {
        videoEncoding: preset.encoding,
        videoSimulcastLayers: getSimulcastLayers(preset),
      },
    });
    this.setupEventListeners();
  }

  async connect(serverUrl: string, token: string): Promise<void> {
    await this.disconnect();
    this.publications.clear();
    await this.room.connect(serverUrl, token, { autoSubscribe: false });
    this.readRoomTracks();
    if (activeInput()) await this.room.switchActiveDevice("audioinput", activeInput());
    if (activeOutput()) await this.room.switchActiveDevice("audiooutput", activeOutput());
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
    this.publications.clear();
  }

  private readRoomTracks(): void {
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.storePublication(participant, publication);
      }
    }
  }

  private storePublication(participant: RemoteParticipant, publication: RemoteTrackPublication): void {
    const userId = parseInt(participant.identity, 10);
    const key: PublicationKey = `${userId}-${publication.source}`;
    this.publications.set(key, publication);

    if (publication.source === Track.Source.Microphone) {
      publication.setSubscribed(true);
    }
  }

  private removePublication(participant: RemoteParticipant, publication: RemoteTrackPublication): void {
    const userId = parseInt(participant.identity, 10);
    const key: PublicationKey = `${userId}-${publication.source}`;
    this.publications.delete(key);
  }

  private setupEventListeners(): void {
    const [, playback] = usePlayback();

    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      const userId = parseInt(participant.identity, 10);
      playback.attachTrack(userId, track.source, track);
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      const userId = parseInt(participant.identity, 10);
      playback.detachTrack(userId, track.source);
    });

    this.room.on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      this.storePublication(participant, publication);
    });

    this.room.on(RoomEvent.TrackUnpublished, (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      this.removePublication(participant, publication);
    });

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<Participant>) => {
      const speakingIds = new Set(speakers.map((s) => parseInt(s.identity, 10)));
      for (const participant of this.room.remoteParticipants.values()) {
        const userId = parseInt(participant.identity, 10);
        playback.updateSpeakingState(userId, speakingIds.has(userId));
      }
    });

    this.room.on(RoomEvent.ParticipantPermissionsChanged, async (_, participant: Participant) => {
      if (participant === this.room.localParticipant && participant.permissions?.canPublish) {
        await this.setMicEnabled(true);
      }
    });
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
    const publication = this.publications.get(key);
    if (publication) {
      publication.setSubscribed(subscribed);
    }
  }


  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.room?.localParticipant) return;
    if (enabled) {
      await this.room.localParticipant.setMicrophoneEnabled(true);
      const track = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track) {
        if (muted()) {
          await track.mute();
        } else {
          await track.setProcessor(this.noiseProcessor);
          this.noiseProcessor.enabled = noiseCancellation();
        }
      }
    } else {
      await this.room.localParticipant.setMicrophoneEnabled(false);
    }
  }

  async setMicMuted(isMuted: boolean): Promise<void> {
    setMuted(isMuted);
    const track = this.room?.localParticipant?.getTrackPublication(Track.Source.Microphone)?.track;
    if (!track) return;

    if (isMuted) {
      await track.stopProcessor();
      await track.mute();
    } else {
      await track.unmute();
      await track.setProcessor(this.noiseProcessor);
      this.noiseProcessor.enabled = noiseCancellation();
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!this.room?.localParticipant) return;
    await this.room.localParticipant.setCameraEnabled(enabled);
  }

  async setScreenShareEnabled(enabled: boolean): Promise<void> {
    if (!this.room?.localParticipant) return;

    await this.room.localParticipant.setScreenShareEnabled(enabled, {
      audio: true,
    });
  }

  getVideoQuality = videoQuality;
  setVideoQuality = setVideoQuality;
  getVideoQualityOptions = () => VIDEO_QUALITY_OPTIONS;

  getMuted = muted;
  setMuted = setMuted;

  getDeafened = deafened;
  setDeafened = setDeafened;

  getNoiseCancellation = noiseCancellation;
  setNoiseCancellation = (enabled: boolean) => {
    setNoiseCancellation(enabled);
    this.noiseProcessor.enabled = enabled;
  };


  getConnectionState(): ConnectionState | null {
    return this.room?.state ?? null;
  }

  isConnected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  async refreshDevices(): Promise<void> {
    const [inputs, outputs] = await Promise.all([
      Room.getLocalDevices("audioinput"),
      Room.getLocalDevices("audiooutput"),
    ]);
    setInputDevices(inputs.map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 8)}` })));
    setOutputDevices(outputs.map((d) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0, 8)}` })));
    setActiveInput(this.room?.getActiveDevice("audioinput") ?? inputs[0]?.deviceId ?? "");
    setActiveOutput(this.room?.getActiveDevice("audiooutput") ?? outputs[0]?.deviceId ?? "");
  }

  getAudioInputDevices = inputDevices;
  getAudioOutputDevices = outputDevices;
  getActiveAudioInput = activeInput;
  getActiveAudioOutput = activeOutput;

  async setAudioInputDevice(deviceId: string): Promise<void> {
    setActiveInput(deviceId);
    if (this.room) await this.room.switchActiveDevice("audioinput", deviceId);
  }

  async setAudioOutputDevice(deviceId: string): Promise<void> {
    setActiveOutput(deviceId);
    if (this.room) await this.room.switchActiveDevice("audiooutput", deviceId);
  }
}

let instance: LiveKitManager | null = null;

export function getLiveKitManager(): LiveKitManager {
  if (!instance) {
    instance = new LiveKitManager();
    navigator.mediaDevices.addEventListener("devicechange", () => instance?.refreshDevices());
  }
  return instance;
}
