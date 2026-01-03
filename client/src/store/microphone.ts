import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { createVADNode } from "../lib/Vad";
import { usePreference } from "./preference";
import { safelyCancelReader, closeEncoder, stopStreamTracks, createMonoConverter } from "../utils";

export interface MicrophoneConstraints {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

interface MicrophoneState {
  volume: number;
  deviceId: string;
  isRecording: boolean;
  muted: boolean;
  availableInputs: MediaDeviceInfo[];
  quality: number;
}

export interface MicrophoneActions {
  setDevice: (deviceId: string) => Promise<void>;
  setVolume: (volume: number) => void;
  setQuality: (quality: number) => void;
  setMuted: (muted: boolean) => void;
  setConstraints: (constraints: Partial<MicrophoneConstraints>) => void;
  onEncodedData: (callback: (chunk: EncodedAudioChunk, sequence: number) => void) => () => void;
  onSpeech: (callback: (isSpeech: boolean) => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type MicrophoneStore = [MicrophoneState, MicrophoneActions];

const DEFAULT_QUALITY = 128_000;
const DEFAULT_VOLUME = 100;
const MAX_VOLUME = 200;
const MIN_VOLUME = 0;

const DEFAULT_CONSTRAINTS: MicrophoneConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
};

const DEFAULT_ENCODER_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: 48000,
  numberOfChannels: 1,
  bitrate: DEFAULT_QUALITY,
};

function buildMediaConstraints(
  deviceId: string,
  constraints: MicrophoneConstraints
): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: constraints.echoCancellation,
      noiseSuppression: constraints.noiseSuppression,
      autoGainControl: constraints.autoGainControl,
      sampleRate: constraints.sampleRate,
      channelCount: constraints.channelCount,
    },
  };
}

function createEncoderInstance(
  config: AudioEncoderConfig,
  onOutput: (chunk: EncodedAudioChunk) => void
): AudioEncoder {
  const encoder = new AudioEncoder({
    output: (chunk) => onOutput(chunk),
    error: (error) => console.error("Encoder error:", error),
  });
  encoder.configure(config);
  return encoder;
}

function clampVolume(volume: number): number {
  return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, volume));
}

async function fetchAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}

function createMicrophoneStore(): MicrophoneStore {
  const [, pref] = usePreference();

  const [state, setState] = createStore<MicrophoneState>({
    volume: pref.get<number>("mic:volume") ?? DEFAULT_VOLUME,
    deviceId: pref.get<string>("mic:deviceId") ?? "",
    isRecording: false,
    muted: false,
    availableInputs: [],
    quality: pref.get<number>("mic:quality") ?? DEFAULT_QUALITY,
  });

  const encodedDataCallbacks = new Set<(chunk: EncodedAudioChunk, sequence: number) => void>();
  const speechCallbacks = new Set<(isSpeech: boolean) => void>();
  let sequence = 0;

  let constraints = { ...DEFAULT_CONSTRAINTS };
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let processor: MediaStreamTrackProcessor<AudioData> | null = null;
  let encoder: AudioEncoder | null = null;
  let reader: ReadableStreamDefaultReader<AudioData> | null = null;
  let isProcessing = false;
  const convertMono = createMonoConverter();

  function notifyEncodedData(chunk: EncodedAudioChunk): void {
    encodedDataCallbacks.forEach((cb) => cb(chunk, sequence++));
  }

  function notifySpeech(isSpeech: boolean): void {
    speechCallbacks.forEach((cb) => cb(isSpeech));
  }

  async function updateAvailableDevices(): Promise<void> {
    try {
      const audioInputs = await fetchAudioInputDevices();
      setState("availableInputs", audioInputs);
    } catch (error) {
      console.error("Error updating available devices:", error);
    }
  }

  async function processAudioStream(): Promise<void> {
    if (!processor) return;
    reader = processor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          if (encoder?.state === "configured") {
            const needsMonoConversion =
              value.numberOfChannels === 2 && DEFAULT_ENCODER_CONFIG.numberOfChannels === 1;

            if (needsMonoConversion) {
              const monoData = convertMono(value);
              encoder.encode(monoData);
              monoData.close();
            } else {
              encoder.encode(value);
            }
          }
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) console.error("Error processing audio stream:", error);
    }
  }

  async function cleanup(): Promise<void> {
    await safelyCancelReader(reader);
    reader = null;
    closeEncoder(encoder);
    encoder = null;
    stopStreamTracks(stream);
    stream = null;
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
    gainNode = null;
    processor = null;
    sequence = 0;
  }

  updateAvailableDevices();
  navigator.mediaDevices.addEventListener("devicechange", updateAvailableDevices);

  const actions: MicrophoneActions = {
    async setDevice(deviceId) {
      setState("deviceId", deviceId);
      pref.set("mic:deviceId", deviceId);
      if (state.isRecording) {
        await this.stop();
        await this.start();
      }
    },

    setVolume(volume) {
      const clampedVolume = clampVolume(volume);
      setState("volume", clampedVolume);
      pref.set("mic:volume", clampedVolume);
      if (gainNode) {
        gainNode.gain.value = clampedVolume / 100;
      }
    },

    setQuality(quality) {
      setState("quality", quality);
      pref.set("mic:quality", quality);
      if (encoder?.state === "configured") {
        encoder.configure({ ...DEFAULT_ENCODER_CONFIG, bitrate: quality });
      }
    },

    setMuted(muted) {
      setState("muted", muted);
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    onEncodedData(callback) {
      encodedDataCallbacks.add(callback);
      return () => encodedDataCallbacks.delete(callback);
    },

    onSpeech(callback) {
      speechCallbacks.add(callback);
      return () => speechCallbacks.delete(callback);
    },

    async start() {
      if (state.isRecording) {
        console.warn("Already recording");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildMediaConstraints(state.deviceId, constraints)
        );

        audioContext = new AudioContext({ sampleRate: constraints.sampleRate });

        const vad = await createVADNode(audioContext, "sensitive");
        const source = audioContext.createMediaStreamSource(stream);
        const destination = audioContext.createMediaStreamDestination();

        source.connect(vad.getInput());

        gainNode = audioContext.createGain();
        gainNode.gain.value = state.volume / 100;

        vad.connect(gainNode);
        gainNode.connect(destination);

        vad.addEventListener("speechstart", () => {
          if (!state.muted) notifySpeech(true);
        });

        vad.addEventListener("speechend", () => {
          notifySpeech(false);
        });

        const audioTrack = destination.stream.getAudioTracks()[0];
        audioTrack.onended = () => this.stop();

        processor = new MediaStreamTrackProcessor({ track: audioTrack });
        encoder = createEncoderInstance(
          { ...DEFAULT_ENCODER_CONFIG, bitrate: state.quality },
          (chunk) => {
            if (!state.muted) notifyEncodedData(chunk);
          }
        );

        isProcessing = true;
        processAudioStream();

        await updateAvailableDevices();
        setState("isRecording", true);
      } catch (error) {
        console.error("Error starting microphone:", error);
        await cleanup();
        throw error;
      }
    },

    async stop() {
      if (!state.isRecording) return;
      isProcessing = false;
      if (encoder?.state === "configured") await encoder.flush();
      await cleanup();
      setState("isRecording", false);
    },

    async destroy() {
      await this.stop();
      encodedDataCallbacks.clear();
      speechCallbacks.clear();
    },
  };

  return [state, actions];
}

let instance: MicrophoneStore | null = null;

export function useMicrophone(): MicrophoneStore {
  if (!instance) {
    createRoot(() => {
      instance = createMicrophoneStore();
    });
  }
  return instance!;
}
