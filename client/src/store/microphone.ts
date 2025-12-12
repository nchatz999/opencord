import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { createVADNode } from "../contexts/Vad";
import { useConnection, type VoipPayload } from "./connection";
import { useAuth } from "./auth";

export interface MicrophoneConstraints {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface EncoderConfig {
  codec?: string;
  sampleRate?: number;
  numberOfChannels?: number;
  bitrate?: number;
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
  init: () => void;
  listDevices: () => MediaDeviceInfo[];
  setDevice: (deviceId: string) => Promise<void>;
  getDevice: () => string;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setQuality: (quality: number) => void;
  getQuality: () => number;
  setMuted: (muted: boolean) => void;
  getMuted: () => boolean;
  isRecording: () => boolean;
  setConstraints: (constraints: Partial<MicrophoneConstraints>) => void;
  getConstraints: () => MicrophoneConstraints;
  onEncodedData: (callback: (chunk: EncodedAudioChunk) => void) => () => void;
  onSpeech: (callback: (isSpeech: boolean) => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type MicrophoneStore = [MicrophoneState, MicrophoneActions];

function createMicrophoneStore(): MicrophoneStore {
  const [state, setState] = createStore<MicrophoneState>({
    volume: 100.0,
    deviceId: "",
    isRecording: false,
    muted: false,
    availableInputs: [],
    quality: 128000,
  });

  // Callback registries
  const encodedDataCallbacks = new Set<(chunk: EncodedAudioChunk) => void>();
  const speechCallbacks = new Set<(isSpeech: boolean) => void>();

  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let processor: MediaStreamTrackProcessor<AudioData> | null = null;
  let encoder: AudioEncoder | null = null;
  let reader: ReadableStreamDefaultReader<AudioData> | null = null;
  let isProcessing = false;

  let constraints: MicrophoneConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  };

  const encoderConfig: EncoderConfig = {
    codec: "opus",
    sampleRate: 48000,
    numberOfChannels: 1,
    bitrate: 128000,
  };

  // Notification helpers
  function notifyEncodedData(chunk: EncodedAudioChunk): void {
    encodedDataCallbacks.forEach((cb) => cb(chunk));
  }

  function notifySpeech(isSpeech: boolean): void {
    speechCallbacks.forEach((cb) => cb(isSpeech));
  }

  const initializeDeviceList = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      setState("availableInputs", audioInputs);
    } catch (error) {
      console.error("Error initializing device list:", error);
    }
  };

  const updateAvailableDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      setState("availableInputs", audioInputs);
    } catch (error) {
      console.error("Error updating available devices:", error);
    }
  };

  const setupEncoder = () => {
    encoder = new AudioEncoder({
      output: (chunk, _metadata) => {
        if (!state.muted) notifyEncodedData(chunk);
      },
      error: (error) => {
        console.error("Encoder error:", error);
      },
    });

    encoder.configure({ ...encoderConfig, bitrate: state.quality } as AudioEncoderConfig);
  };

  const processAudioStream = async () => {
    if (!processor) return;

    reader = processor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (encoder && encoder.state === "configured") {
            if (value.numberOfChannels === 2 && encoderConfig.numberOfChannels === 1) {
              const buffer = new ArrayBuffer(value.numberOfFrames * 4);
              value.copyTo(buffer, { planeIndex: 0 });
              const monoData = new AudioData({
                format: value.format,
                sampleRate: value.sampleRate,
                numberOfFrames: value.numberOfFrames,
                numberOfChannels: 1,
                timestamp: value.timestamp,
                data: buffer,
              });
              encoder.encode(monoData);
            } else {
              encoder.encode(value);
            }
          }
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing audio stream:", error);
      }
    }
  };

  const cleanup = async () => {
    if (reader) {
      try {
        await reader.cancel();
      } catch (e) {}
      reader = null;
    }

    if (encoder) {
      if (encoder.state !== "closed") {
        encoder.close();
      }
      encoder = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    gainNode = null;
    processor = null;
  };

  initializeDeviceList();
  navigator.mediaDevices.addEventListener("devicechange", updateAvailableDevices);

  const connection = useConnection();
  const [, authActions] = useAuth();

  const actions: MicrophoneActions = {
    init() {
      actions.onEncodedData((data) => {
        const user = authActions.getUser();
        if (!user) return;
        const buffer = new ArrayBuffer(data.byteLength);
        data.copyTo(buffer);
        connection.sendVoip({
          type: "media",
          userId: user.userId,
          mediaType: "voice",
          data: Array.from(new Uint8Array(buffer)),
          timestamp: Date.now(),
          realTimestamp: data.timestamp,
          key: data.type,
        } as VoipPayload);
      });

      actions.onSpeech((speech) => {
        const user = authActions.getUser();
        if (!user) return;
        connection.sendVoip({
          type: "speech",
          userId: user.userId,
          isSpeaking: speech,
        } as VoipPayload);
      });
    },

    listDevices() {
      return state.availableInputs;
    },

    async setDevice(deviceId) {
      setState("deviceId", deviceId);
      if (state.isRecording) {
        await actions.stop();
        await actions.start();
      }
    },

    getDevice() {
      return state.deviceId;
    },

    setVolume(volume) {
      const clampedVolume = Math.max(0, Math.min(200, volume));
      setState("volume", clampedVolume);
      if (gainNode) {
        gainNode.gain.value = clampedVolume / 100;
      }
    },

    getVolume() {
      return state.volume;
    },

    setQuality(quality) {
      setState("quality", quality);
      if (encoder && encoder.state === "configured") {
        encoder.configure({
          ...encoderConfig,
          bitrate: quality,
        } as AudioEncoderConfig);
      }
    },

    getQuality() {
      return state.quality;
    },

    setMuted(muted) {
      setState("muted", muted);
    },

    getMuted() {
      return state.muted;
    },

    isRecording() {
      return state.isRecording;
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    getConstraints() {
      return { ...constraints };
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
        const mediaConstraints: MediaStreamConstraints = {
          audio: {
            deviceId: state.deviceId ? { exact: state.deviceId } : undefined,
            echoCancellation: constraints.echoCancellation,
            noiseSuppression: constraints.noiseSuppression,
            autoGainControl: constraints.autoGainControl,
            sampleRate: constraints.sampleRate,
            channelCount: constraints.channelCount,
          },
        };

        stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

        audioContext = new AudioContext({
          sampleRate: constraints.sampleRate,
        });

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
        audioTrack.onended = () => actions.stop();
        processor = new MediaStreamTrackProcessor({ track: audioTrack });
        setupEncoder();

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
      if (!state.isRecording) {
        return;
      }
      isProcessing = false;
      if (encoder && encoder.state === "configured") {
        await encoder.flush();
      }
      await cleanup();
      setState("isRecording", false);
    },

    async destroy() {
      await actions.stop();
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
