import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { type QualityPreset, QUALITY_PRESETS, DEFAULT_PRESET } from "../model";
import { usePreference } from "./preference";
import { safelyCancelReader, closeEncoder, stopStreamTracks } from "../utils";

export interface CameraConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
  aspectRatio?: number;
}

interface CameraState {
  isRecording: boolean;
  quality: number;
  preset: QualityPreset;
}

export interface CameraActions {
  setQuality: (quality: number) => void;
  setPreset: (preset: QualityPreset) => void;
  setConstraints: (constraints: Partial<CameraConstraints>) => void;
  onEncodedData: (callback: (chunk: EncodedVideoChunk, sequence: number) => void) => () => void;
  onRecordingStopped: (callback: () => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type CameraStore = [CameraState, CameraActions];

const DEFAULT_VIDEO_BITRATE = 1_500_000;
export const MAX_VIDEO_BITRATE = 6_000_000;
const KEYFRAME_INTERVAL = 30;

const DEFAULT_CONSTRAINTS: CameraConstraints = {
  width: QUALITY_PRESETS[DEFAULT_PRESET].width,
  height: QUALITY_PRESETS[DEFAULT_PRESET].height,
  frameRate: 30,
  facingMode: "user",
  aspectRatio: 16 / 9,
};

const DEFAULT_ENCODER_CONFIG: VideoEncoderConfig = {
  codec: "vp8",
  width: QUALITY_PRESETS[DEFAULT_PRESET].width,
  height: QUALITY_PRESETS[DEFAULT_PRESET].height,
  bitrate: DEFAULT_VIDEO_BITRATE,
  framerate: 30,
  latencyMode: "realtime",
};

function buildMediaConstraints(constraints: CameraConstraints): MediaStreamConstraints {
  return {
    video: {
      width: { ideal: constraints.width },
      height: { ideal: constraints.height },
      frameRate: { ideal: constraints.frameRate },
      facingMode: constraints.facingMode,
      aspectRatio: constraints.aspectRatio,
    },
  };
}

function createEncoderInstance(
  config: VideoEncoderConfig,
  onOutput: (chunk: EncodedVideoChunk) => void
): VideoEncoder {
  const encoder = new VideoEncoder({
    output: (chunk) => onOutput(chunk),
    error: (error) => console.error("Camera encoder error:", error),
  });
  encoder.configure(config);
  return encoder;
}

function createCameraStore(): CameraStore {
  const [, pref] = usePreference();
  const savedPreset = pref.get<QualityPreset>("camera:preset") ?? DEFAULT_PRESET;
  const presetConfig = QUALITY_PRESETS[savedPreset];

  const [state, setState] = createStore<CameraState>({
    isRecording: false,
    quality: pref.get<number>("camera:quality") ?? DEFAULT_VIDEO_BITRATE,
    preset: savedPreset,
  });

  const encodedDataCallbacks = new Set<(chunk: EncodedVideoChunk, sequence: number) => void>();
  const recordingStoppedCallbacks = new Set<() => void>();

  let sequence = 0;
  let frameCount = 0;
  let constraints: CameraConstraints = { ...DEFAULT_CONSTRAINTS, width: presetConfig.width, height: presetConfig.height };
  let stream: MediaStream | null = null;
  let processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let encoder: VideoEncoder | null = null;
  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let isProcessing = false;

  function notifyEncodedData(chunk: EncodedVideoChunk): void {
    encodedDataCallbacks.forEach((cb) => cb(chunk, sequence++));
  }

  function notifyRecordingStopped(): void {
    recordingStoppedCallbacks.forEach((cb) => cb());
  }

  async function processVideoStream(): Promise<void> {
    if (!processor) return;
    reader = processor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          if (encoder?.state === "configured") {
            encoder.encode(value, { keyFrame: frameCount++ % KEYFRAME_INTERVAL === 0 });
          }
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) console.error("Error processing camera stream:", error);
    }
  }

  async function cleanup(): Promise<void> {
    await safelyCancelReader(reader);
    reader = null;
    closeEncoder(encoder);
    encoder = null;
    stopStreamTracks(stream);
    stream = null;
    processor = null;
    sequence = 0;
    frameCount = 0;
  }

  const actions: CameraActions = {
    setQuality(quality) {
      setState("quality", quality);
      pref.set("camera:quality", quality);
      if (encoder?.state === "configured") {
        encoder.configure({ ...DEFAULT_ENCODER_CONFIG, bitrate: quality });
      }
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    setPreset(preset: QualityPreset) {
      const config = QUALITY_PRESETS[preset];
      setState("preset", preset);
      pref.set("camera:preset", preset);
      this.setConstraints({ width: config.width, height: config.height });
      if (encoder?.state === "configured") {
        encoder.configure({
          ...DEFAULT_ENCODER_CONFIG,
          width: config.width,
          height: config.height,
          bitrate: state.quality,
        });
      }
    },

    onEncodedData(callback) {
      encodedDataCallbacks.add(callback);
      return () => encodedDataCallbacks.delete(callback);
    },

    onRecordingStopped(callback) {
      recordingStoppedCallbacks.add(callback);
      return () => recordingStoppedCallbacks.delete(callback);
    },

    async start() {
      if (state.isRecording) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia(buildMediaConstraints(constraints));
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = () => {
          notifyRecordingStopped();
          this.stop();
        };

        processor = new MediaStreamTrackProcessor({ track: videoTrack });
        encoder = createEncoderInstance(
          { ...DEFAULT_ENCODER_CONFIG, bitrate: state.quality },
          notifyEncodedData
        );

        isProcessing = true;
        processVideoStream();
        setState("isRecording", true);
      } catch (error) {
        console.error("Error starting camera:", error);
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
      recordingStoppedCallbacks.clear();
    },
  };

  return [state, actions];
}

let instance: CameraStore | null = null;

export function useCamera(): CameraStore {
  if (!instance) {
    createRoot(() => {
      instance = createCameraStore();
    });
  }
  return instance!;
}
