import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { fetchApi } from "../utils";
import { useConnection, type VoipPayload } from "./connection";
import { useAuth } from "./auth";

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
}

export interface CameraActions {
  init: () => void;
  isRecording: () => boolean;
  setQuality: (quality: number) => void;
  getQuality: () => number;
  setConstraints: (constraints: Partial<CameraConstraints>) => void;
  getStream: () => MediaStream | null;
  onEncodedData: (callback: (chunk: EncodedVideoChunk) => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type CameraStore = [CameraState, CameraActions];

function createCameraStore(): CameraStore {
  const defaultBitrate = 1500000;

  const [state, setState] = createStore<CameraState>({
    isRecording: false,
    quality: defaultBitrate,
  });

  // Callback registry
  const encodedDataCallbacks = new Set<(chunk: EncodedVideoChunk) => void>();

  let stream: MediaStream | null = null;
  let processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let encoder: VideoEncoder | null = null;
  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let isProcessing = false;

  let constraints: CameraConstraints = {
    width: 1280,
    height: 720,
    frameRate: 30,
    facingMode: "user",
    aspectRatio: 16 / 9,
  };

  const encoderConfig = {
    codec: "vp8",
    width: 1280,
    height: 720,
    bitrate: defaultBitrate,
    framerate: 30,
  };

  function notifyEncodedData(chunk: EncodedVideoChunk): void {
    encodedDataCallbacks.forEach((cb) => cb(chunk));
  }

  const setupEncoder = () => {
    encoder = new VideoEncoder({
      output: (chunk, _metadata) => {
        notifyEncodedData(chunk);
      },
      error: (error) => {
        console.error("Camera encoder error:", error);
      },
    });

    encoder.configure({ ...encoderConfig, bitrate: state.quality });
  };

  const processVideoStream = async () => {
    if (!processor) return;

    reader = processor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await reader.read();

        if (done) break;

        if (value) {
          if (encoder && encoder.state === "configured") {
            const keyFrame = Math.random() < 0.03;
            encoder.encode(value, { keyFrame });
          }
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing camera stream:", error);
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

    processor = null;
  };

  const connection = useConnection();
  const [, authActions] = useAuth();

  const actions: CameraActions = {
    init() {
      actions.onEncodedData((data) => {
        const user = authActions.getUser();
        if (!user) return;
        const buffer = new ArrayBuffer(data.byteLength);
        data.copyTo(buffer);
        connection.sendVoip({
          type: "media",
          userId: user.userId,
          mediaType: "camera",
          data: Array.from(new Uint8Array(buffer)),
          timestamp: Date.now(),
          realTimestamp: data.timestamp,
          key: data.type,
        } as VoipPayload);
      });
    },

    isRecording() {
      return state.isRecording;
    },

    setQuality(quality) {
      setState("quality", quality);
      if (encoder && encoder.state === "configured") {
        encoder.configure({
          ...encoderConfig,
          bitrate: quality,
        });
      }
    },

    getQuality() {
      return state.quality;
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    getStream() {
      return stream;
    },

    onEncodedData(callback) {
      encodedDataCallbacks.add(callback);
      return () => encodedDataCallbacks.delete(callback);
    },

    async start() {
      if (state.isRecording) {
        console.warn("Camera already recording");
        return;
      }

      try {
        const mediaConstraints: MediaStreamConstraints = {
          video: {
            width: { ideal: constraints.width },
            height: { ideal: constraints.height },
            frameRate: { ideal: constraints.frameRate },
            facingMode: constraints.facingMode,
            aspectRatio: constraints.aspectRatio,
          },
        };

        stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        const videoTrack = stream.getVideoTracks()[0];

        videoTrack.onended = async () => {
          await fetchApi("/voip/camera/publish", {
            method: "PUT",
            body: { publish: false },
          });
          actions.stop();
        };

        processor = new MediaStreamTrackProcessor({ track: videoTrack });

        setupEncoder();

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
