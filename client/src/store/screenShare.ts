import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { fetchApi } from "../utils";
import { useConnection, type VoipPayload } from "./connection";
import { useAuth } from "./auth";

export interface ScreenShareConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  cursor?: "always" | "motion" | "never";
  displaySurface?: "application" | "browser" | "monitor" | "window";
  audio?: boolean;
}

interface ScreenShareState {
  isRecording: boolean;
  quality: number;
}

export interface ScreenShareActions {
  init: () => void;
  isRecording: () => boolean;
  setQuality: (quality: number) => void;
  getQuality: () => number;
  setConstraints: (constraints: Partial<ScreenShareConstraints>) => void;
  getConstraints: () => ScreenShareConstraints;
  getStream: () => MediaStream | null;
  onEncodedVideoData: (callback: (chunk: EncodedVideoChunk) => void) => () => void;
  onEncodedAudioData: (callback: (chunk: EncodedAudioChunk) => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type ScreenShareStore = [ScreenShareState, ScreenShareActions];

function createScreenShareStore(): ScreenShareStore {
  const defaultBitrate = 2500000;

  const [state, setState] = createStore<ScreenShareState>({
    isRecording: false,
    quality: defaultBitrate,
  });

  // Callback registries
  const encodedVideoDataCallbacks = new Set<(chunk: EncodedVideoChunk) => void>();
  const encodedAudioDataCallbacks = new Set<(chunk: EncodedAudioChunk) => void>();

  let stream: MediaStream | null = null;

  let videoProcessor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;

  let audioProcessor: MediaStreamTrackProcessor<AudioData> | null = null;
  let audioEncoder: AudioEncoder | null = null;
  let audioReader: ReadableStreamDefaultReader<AudioData> | null = null;

  let isProcessing = false;

  let constraints: ScreenShareConstraints = {
    width: 1920,
    height: 1080,
    frameRate: 60,
    cursor: "always",
    audio: true,
  };

  const videoEncoderConfig = {
    codec: "vp8",
    width: 1920,
    height: 1080,
    bitrate: defaultBitrate,
    framerate: 60,
    keyFrameIntervalCount: 30,
  };

  const audioEncoderConfig = {
    codec: "opus",
    sampleRate: 48000,
    numberOfChannels: 1,
    bitrate: 128000,
  };

  function notifyEncodedVideoData(chunk: EncodedVideoChunk): void {
    encodedVideoDataCallbacks.forEach((cb) => cb(chunk));
  }

  function notifyEncodedAudioData(chunk: EncodedAudioChunk): void {
    encodedAudioDataCallbacks.forEach((cb) => cb(chunk));
  }

  const setupVideoEncoder = () => {
    const config = {
      ...videoEncoderConfig,
      bitrate: Math.floor(videoEncoderConfig.bitrate * state.quality),
    };

    videoEncoder = new VideoEncoder({
      output: (chunk, _metadata) => {
        notifyEncodedVideoData(chunk);
      },
      error: (error) => {
        console.error("Video encoder error:", error);
      },
    });

    videoEncoder.configure(config);
  };

  const setupAudioEncoder = () => {
    audioEncoder = new AudioEncoder({
      output: (chunk, _metadata) => {
        notifyEncodedAudioData(chunk);
      },
      error: (error) => {
        console.error("Audio encoder error:", error);
      },
    });

    const config = {
      codec: audioEncoderConfig.codec,
      sampleRate: audioEncoderConfig.sampleRate,
      numberOfChannels: audioEncoderConfig.numberOfChannels,
      bitrate: audioEncoderConfig.bitrate,
    };

    audioEncoder.configure(config);
  };

  const processVideoStream = async () => {
    if (!videoProcessor) return;

    videoReader = videoProcessor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await videoReader.read();

        if (done) break;
        if (value) {
          if (videoEncoder && videoEncoder.state === "configured") {
            const keyFrame = Math.random() < 0.03;
            videoEncoder.encode(value, { keyFrame });
          }
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing video stream:", error);
      }
    }
  };

  const processAudioStream = async () => {
    if (!audioProcessor) return;

    audioReader = audioProcessor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await audioReader.read();

        if (done) break;

        if (value) {
          if (audioEncoder && audioEncoder.state === "configured") {
            if (value.numberOfChannels === 2 && audioEncoderConfig.numberOfChannels === 1) {
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

              audioEncoder.encode(monoData);
            } else {
              audioEncoder.encode(value);
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
    if (audioReader) {
      try {
        await audioReader.cancel();
      } catch (e) {}
      audioReader = null;
    }
    audioProcessor = null;

    if (videoReader) {
      try {
        await videoReader.cancel();
      } catch (e) {}
      videoReader = null;
    }
    videoProcessor = null;

    if (audioEncoder && audioEncoder.state !== "closed") {
      audioEncoder.close();
      audioEncoder = null;
    }
    if (videoEncoder && videoEncoder.state !== "closed") {
      videoEncoder.close();
      videoEncoder = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  };

  const connection = useConnection();
  const [, authActions] = useAuth();

  const actions: ScreenShareActions = {
    init() {
      actions.onEncodedVideoData((data) => {
        const user = authActions.getUser();
        if (!user) return;
        const buffer = new ArrayBuffer(data.byteLength);
        data.copyTo(buffer);
        connection.sendVoip({
          type: "media",
          userId: user.userId,
          mediaType: "screen",
          data: Array.from(new Uint8Array(buffer)),
          timestamp: Date.now(),
          realTimestamp: data.timestamp,
          key: data.type,
        } as VoipPayload);
      });

      actions.onEncodedAudioData((data) => {
        const user = authActions.getUser();
        if (!user) return;
        const buffer = new ArrayBuffer(data.byteLength);
        data.copyTo(buffer);
        connection.sendVoip({
          type: "media",
          userId: user.userId,
          mediaType: "screenSound",
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
      if (videoEncoder && videoEncoder.state === "configured") {
        videoEncoder.configure({
          ...videoEncoderConfig,
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

    getConstraints() {
      return { ...constraints };
    },

    getStream() {
      return stream;
    },

    onEncodedVideoData(callback) {
      encodedVideoDataCallbacks.add(callback);
      return () => encodedVideoDataCallbacks.delete(callback);
    },

    onEncodedAudioData(callback) {
      encodedAudioDataCallbacks.add(callback);
      return () => encodedAudioDataCallbacks.delete(callback);
    },

    async start() {
      if (state.isRecording) {
        return;
      }

      try {
        const mediaConstraints = {
          video: {
            width: constraints.width,
            height: constraints.height,
            frameRate: constraints.frameRate,
            cursor: constraints.cursor,
            displaySurface: constraints.displaySurface,
          } as MediaTrackConstraints,
          audio: constraints.audio,
        };

        stream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);

        stream.getVideoTracks()[0].onended = async () => {
          await fetchApi("/voip/screen/publish", {
            method: "PUT",
            body: { publish: false },
          });

          actions.stop();
        };

        const videoTrack = stream.getVideoTracks()[0];
        videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
        setupVideoEncoder();

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
          setupAudioEncoder();
        } else if (constraints.audio) {
          console.warn("Requested audio but no audio track was provided by getDisplayMedia.");
        }

        isProcessing = true;
        setState("isRecording", true);
        processVideoStream();
        processAudioStream();
      } catch (error) {
        console.error("Error starting screen share:", error);
        await cleanup();
        throw error;
      }
    },

    async stop() {
      if (!state.isRecording) {
        return;
      }

      isProcessing = false;

      if (videoEncoder && videoEncoder.state === "configured") {
        await videoEncoder.flush();
      }
      if (audioEncoder && audioEncoder.state === "configured") {
        await audioEncoder.flush();
      }

      await cleanup();
      setState("isRecording", false);
    },

    async destroy() {
      await actions.stop();
      encodedVideoDataCallbacks.clear();
      encodedAudioDataCallbacks.clear();
    },
  };

  return [state, actions];
}

let instance: ScreenShareStore | null = null;

export function useScreenShare(): ScreenShareStore {
  if (!instance) {
    createRoot(() => {
      instance = createScreenShareStore();
    });
  }
  return instance!;
}
