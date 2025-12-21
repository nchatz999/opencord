import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { useConnection, type VoipPayload } from "./connection";
import { useAuth } from "./auth";
import { type QualityPreset, QUALITY_PRESETS, DEFAULT_PRESET } from "../model";

export interface CameraConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: "user" | "environment";
  aspectRatio?: number;
}

export interface VideoEncoderConfig {
  codec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
}

interface CameraState {
  isRecording: boolean;
  quality: number;
  preset: QualityPreset;
}

export interface CameraActions {
  init: () => void;
  isRecording: () => boolean;
  setQuality: (quality: number) => void;
  getQuality: () => number;
  setConstraints: (constraints: Partial<CameraConstraints>) => void;
  getPreset: () => QualityPreset;
  setPreset: (preset: QualityPreset) => void;
  onEncodedData: (callback: (chunk: EncodedVideoChunk) => void) => () => void;
  onRecordingStopped: (callback: () => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type CameraStore = [CameraState, CameraActions];

const DEFAULT_BITRATE = 1_500_000;
const KEYFRAME_PROBABILITY = 0.03;

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
  bitrate: DEFAULT_BITRATE,
  framerate: 30,
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

function encodeChunkToUint8Array(chunk: EncodedVideoChunk): Uint8Array {
  const buffer = new ArrayBuffer(chunk.byteLength);
  chunk.copyTo(buffer);
  return new Uint8Array(buffer);
}

function createEncoderInstance(
  bitrate: number,
  onOutput: (chunk: EncodedVideoChunk) => void
): VideoEncoder {
  const encoder = new VideoEncoder({
    output: (chunk) => onOutput(chunk),
    error: (error) => console.error("Camera encoder error:", error),
  });

  encoder.configure({ ...DEFAULT_ENCODER_CONFIG, bitrate });
  return encoder;
}

async function safelyCancelReader(
  reader: ReadableStreamDefaultReader<VideoFrame> | null
): Promise<void> {
  if (!reader) return;
  try {
    await reader.cancel();
  } catch { }
}

function closeEncoder(encoder: VideoEncoder | null): void {
  if (encoder && encoder.state !== "closed") {
    encoder.close();
  }
}

function stopStreamTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function createCameraStore(): CameraStore {
  const [state, setState] = createStore<CameraState>({
    isRecording: false,
    quality: DEFAULT_BITRATE,
    preset: DEFAULT_PRESET,
  });

  const encodedDataCallbacks = new Set<(chunk: EncodedVideoChunk) => void>();
  const recordingStoppedCallbacks = new Set<() => void>();
  let constraints = { ...DEFAULT_CONSTRAINTS };
  let stream: MediaStream | null = null;
  let processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let encoder: VideoEncoder | null = null;
  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let isProcessing = false;

  const connection = useConnection();
  const [, authActions] = useAuth();

  function notifyEncodedData(chunk: EncodedVideoChunk): void {
    encodedDataCallbacks.forEach((cb) => cb(chunk));
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

        if (value && encoder?.state === "configured") {
          const keyFrame = Math.random() < KEYFRAME_PROBABILITY;
          encoder.encode(value, { keyFrame });
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing camera stream:", error);
      }
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
  }

  async function handleTrackEnded() {
    notifyRecordingStopped();
    actions.stop();
  }

  const actions: CameraActions = {
    init() {},

    isRecording: () => state.isRecording,

    getQuality: () => state.quality,

    setQuality(quality) {
      setState("quality", quality);

      if (encoder?.state === "configured") {
        encoder.configure({ ...DEFAULT_ENCODER_CONFIG, bitrate: quality });
      }
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    getPreset: () => state.preset,

    setPreset(preset: QualityPreset) {
      const config = QUALITY_PRESETS[preset];
      setState("preset", preset);
      this.setConstraints({
        width: config.width,
        height: config.height,
      });
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
      if (state.isRecording) {
        console.warn("Camera already recording");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia(
          buildMediaConstraints(constraints)
        );

        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = handleTrackEnded;

        processor = new MediaStreamTrackProcessor({ track: videoTrack });
        encoder = createEncoderInstance(state.quality, notifyEncodedData);

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

      if (encoder?.state === "configured") {
        await encoder.flush();
      }

      await cleanup();
      setState("isRecording", false);
    },

    async destroy() {
      await this.stop();
      encodedDataCallbacks.clear();
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
