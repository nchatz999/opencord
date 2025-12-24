import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { type QualityPreset, QUALITY_PRESETS, DEFAULT_PRESET } from "../model";
import { usePreference } from "./preference";

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
  preset: QualityPreset;
}

export interface ScreenShareActions {
  init: () => void;
  isRecording: () => boolean;
  setQuality: (quality: number) => void;
  getQuality: () => number;
  setConstraints: (constraints: Partial<ScreenShareConstraints>) => void;
  getConstraints: () => ScreenShareConstraints;
  getPreset: () => QualityPreset;
  setPreset: (preset: QualityPreset) => void;
  onEncodedVideoData: (callback: (chunk: EncodedVideoChunk, sequence: number) => void) => () => void;
  onEncodedAudioData: (callback: (chunk: EncodedAudioChunk, sequence: number) => void) => () => void;
  onRecordingStopped: (callback: () => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
}

export type ScreenShareStore = [ScreenShareState, ScreenShareActions];

const DEFAULT_VIDEO_BITRATE = 2_500_000;
const DEFAULT_AUDIO_BITRATE = 128_000;
const KEYFRAME_PROBABILITY = 0.03;

const DEFAULT_CONSTRAINTS: ScreenShareConstraints = {
  width: QUALITY_PRESETS[DEFAULT_PRESET].width,
  height: QUALITY_PRESETS[DEFAULT_PRESET].height,
  frameRate: 60,
  cursor: "always",
  audio: true,
};

const DEFAULT_VIDEO_ENCODER_CONFIG = {
  codec: "vp8",
  width: QUALITY_PRESETS[DEFAULT_PRESET].width,
  height: QUALITY_PRESETS[DEFAULT_PRESET].height,
  bitrate: DEFAULT_VIDEO_BITRATE,
  framerate: 60,
  keyFrameIntervalCount: 30,
};

const DEFAULT_AUDIO_ENCODER_CONFIG = {
  codec: "opus",
  sampleRate: 48000,
  numberOfChannels: 1,
  bitrate: DEFAULT_AUDIO_BITRATE,
};

function encodeChunkToUint8Array(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const buffer = new ArrayBuffer(chunk.byteLength);
  chunk.copyTo(buffer);
  return new Uint8Array(buffer);
}

function buildMediaConstraints(constraints: ScreenShareConstraints): DisplayMediaStreamOptions {
  return {
    video: {
      width: constraints.width,
      height: constraints.height,
      frameRate: constraints.frameRate,
      cursor: constraints.cursor,
      displaySurface: constraints.displaySurface,
    } as MediaTrackConstraints,
    audio: constraints.audio,
  };
}

function createVideoEncoderInstance(
  bitrate: number,
  onOutput: (chunk: EncodedVideoChunk) => void
): VideoEncoder {
  const encoder = new VideoEncoder({
    output: (chunk) => onOutput(chunk),
    error: (error) => console.error("Video encoder error:", error),
  });

  encoder.configure({ ...DEFAULT_VIDEO_ENCODER_CONFIG, bitrate });
  return encoder;
}

function createAudioEncoderInstance(
  onOutput: (chunk: EncodedAudioChunk) => void
): AudioEncoder {
  const encoder = new AudioEncoder({
    output: (chunk) => onOutput(chunk),
    error: (error) => console.error("Audio encoder error:", error),
  });

  encoder.configure(DEFAULT_AUDIO_ENCODER_CONFIG);
  return encoder;
}

function convertToMono(value: AudioData): AudioData {
  const buffer = new ArrayBuffer(value.numberOfFrames * 4);
  value.copyTo(buffer, { planeIndex: 0 });

  return new AudioData({
    format: value.format,
    sampleRate: value.sampleRate,
    numberOfFrames: value.numberOfFrames,
    numberOfChannels: 1,
    timestamp: value.timestamp,
    data: buffer,
  });
}

async function safelyCancelReader<T>(
  reader: ReadableStreamDefaultReader<T> | null
): Promise<void> {
  if (!reader) return;
  try {
    await reader.cancel();
  } catch { }
}

function closeEncoder(encoder: VideoEncoder | AudioEncoder | null): void {
  if (encoder && encoder.state !== "closed") {
    encoder.close();
  }
}

function stopStreamTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function createScreenShareStore(): ScreenShareStore {
  const [, pref] = usePreference();

  const savedPreset = pref.get<QualityPreset>("screen:preset") ?? DEFAULT_PRESET;
  const presetConfig = QUALITY_PRESETS[savedPreset];

  const [state, setState] = createStore<ScreenShareState>({
    isRecording: false,
    quality: pref.get<number>("screen:quality") ?? DEFAULT_VIDEO_BITRATE,
    preset: savedPreset,
  });

  const encodedVideoDataCallbacks = new Set<(chunk: EncodedVideoChunk, sequence: number) => void>();
  const encodedAudioDataCallbacks = new Set<(chunk: EncodedAudioChunk, sequence: number) => void>();
  const recordingStoppedCallbacks = new Set<() => void>();
  let videoSequence = 0;
  let audioSequence = 0;

  let constraints: ScreenShareConstraints = {
    ...DEFAULT_CONSTRAINTS,
    width: presetConfig.width,
    height: presetConfig.height,
  };
  let stream: MediaStream | null = null;
  let videoProcessor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let videoEncoder: VideoEncoder | null = null;
  let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let audioProcessor: MediaStreamTrackProcessor<AudioData> | null = null;
  let audioEncoder: AudioEncoder | null = null;
  let audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
  let isProcessing = false;

  function notifyEncodedVideoData(chunk: EncodedVideoChunk): void {
    encodedVideoDataCallbacks.forEach((cb) => cb(chunk, videoSequence++));
  }

  function notifyEncodedAudioData(chunk: EncodedAudioChunk): void {
    encodedAudioDataCallbacks.forEach((cb) => cb(chunk, audioSequence++));
  }

  function notifyRecordingStopped(): void {
    recordingStoppedCallbacks.forEach((cb) => cb());
  }

  async function processVideoStream(): Promise<void> {
    if (!videoProcessor) return;

    videoReader = videoProcessor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await videoReader.read();
        if (done) break;

        if (value && videoEncoder?.state === "configured") {
          const keyFrame = Math.random() < KEYFRAME_PROBABILITY;
          videoEncoder.encode(value, { keyFrame });
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing video stream:", error);
      }
    }
  }

  async function processAudioStream(): Promise<void> {
    if (!audioProcessor) return;

    audioReader = audioProcessor.readable.getReader();

    try {
      while (isProcessing) {
        const { done, value } = await audioReader.read();
        if (done) break;

        if (value && audioEncoder?.state === "configured") {
          const needsMonoConversion =
            value.numberOfChannels === 2 && DEFAULT_AUDIO_ENCODER_CONFIG.numberOfChannels === 1;

          audioEncoder.encode(needsMonoConversion ? convertToMono(value) : value);
          value.close();
        }
      }
    } catch (error) {
      if (isProcessing) {
        console.error("Error processing audio stream:", error);
      }
    }
  }

  async function cleanup(): Promise<void> {
    await safelyCancelReader(audioReader);
    audioReader = null;
    audioProcessor = null;

    await safelyCancelReader(videoReader);
    videoReader = null;
    videoProcessor = null;

    closeEncoder(audioEncoder);
    audioEncoder = null;

    closeEncoder(videoEncoder);
    videoEncoder = null;

    stopStreamTracks(stream);
    stream = null;

    videoSequence = 0;
    audioSequence = 0;
  }

  async function handleVideoTrackEnded() {
    notifyRecordingStopped();
    actions.stop();
  }

  const actions: ScreenShareActions = {
    init() {},

    isRecording: () => state.isRecording,

    getQuality: () => state.quality,

    setQuality(quality) {
      setState("quality", quality);
      pref.set("screen:quality", quality);

      if (videoEncoder?.state === "configured") {
        videoEncoder.configure({ ...DEFAULT_VIDEO_ENCODER_CONFIG, bitrate: quality });
      }
    },

    setConstraints(newConstraints) {
      constraints = { ...constraints, ...newConstraints };
    },

    getConstraints: () => ({ ...constraints }),

    getPreset: () => state.preset,

    setPreset(preset: QualityPreset) {
      const config = QUALITY_PRESETS[preset];
      setState("preset", preset);
      pref.set("screen:preset", preset);
      this.setConstraints({
        width: config.width,
        height: config.height,
      });
      if (videoEncoder?.state === "configured") {
        videoEncoder.configure({
          ...DEFAULT_VIDEO_ENCODER_CONFIG,
          width: config.width,
          height: config.height,
          bitrate: state.quality,
        });
      }
    },

    onEncodedVideoData(callback) {
      encodedVideoDataCallbacks.add(callback);
      return () => encodedVideoDataCallbacks.delete(callback);
    },

    onEncodedAudioData(callback) {
      encodedAudioDataCallbacks.add(callback);
      return () => encodedAudioDataCallbacks.delete(callback);
    },

    onRecordingStopped(callback) {
      recordingStoppedCallbacks.add(callback);
      return () => recordingStoppedCallbacks.delete(callback);
    },

    async start() {
      if (state.isRecording) return;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia(
          buildMediaConstraints(constraints)
        );

        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = handleVideoTrackEnded;

        videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
        videoEncoder = createVideoEncoderInstance(state.quality, notifyEncodedVideoData);

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
          audioEncoder = createAudioEncoderInstance(notifyEncodedAudioData);
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
      if (!state.isRecording) return;

      isProcessing = false;

      if (videoEncoder?.state === "configured") {
        await videoEncoder.flush();
      }

      if (audioEncoder?.state === "configured") {
        await audioEncoder.flush();
      }

      await cleanup();
      setState("isRecording", false);
    },

    async destroy() {
      await this.stop();
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
