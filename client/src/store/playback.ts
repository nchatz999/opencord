import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { AudioPlayback, createSharedAudioContext } from "../lib/AudioPlayback";
import { VideoPlayback } from "../lib/VideoPlayback";
import { usePreference } from "./preference";

export type MediaTypeKey = "voice" | "camera" | "screen" | "screenSound";
export type CallType = "private" | "channel";
type PlaybackKey = `${number}-${MediaTypeKey}`;

interface PlaybackStoreState {
  audio: AudioContext;
  playbacks: Map<PlaybackKey, AudioPlayback | VideoPlayback>;
  speakingStates: Record<number, boolean>;
}

interface PlaybackActions {
  getAudioContext: () => AudioContext;
  resume: () => Promise<void>;
  getPlayback: (userId: number, mediaType: MediaTypeKey) => AudioPlayback | VideoPlayback | undefined;
  createPlayback: (userId: number, mediaType: MediaTypeKey, callType: CallType) => AudioPlayback | VideoPlayback;
  destroyPlayback: (userId: number, mediaType: MediaTypeKey) => void;
  cleanupForUser: (userId: number) => void;
  streamMedia: (
    userId: number,
    mediaType: MediaTypeKey,
    packet: EncodedAudioChunk | EncodedVideoChunk,
    timestamp: number,
    sequence: number,
    callType: CallType
  ) => void;
  updateSpeakingState: (userId: number, isSpeaking: boolean) => void;
  getSpeakingState: (userId: number) => boolean;
  clearSpeakingState: (userId: number) => void;
  adjustVolume: (userId: number, volume: number, callType: CallType) => void;
  getVolume: (userId: number, callType: CallType) => number;
  adjustScreenAudio: (userId: number, volume: number, callType: CallType) => void;
  getScreenAudioVolume: (userId: number, callType: CallType) => number;
}

export type PlaybackStore = [PlaybackStoreState, PlaybackActions];

function createPlaybackStore(): PlaybackStore {
  const [state, setState] = createStore<PlaybackStoreState>({
    audio: createSharedAudioContext(),
    playbacks: new Map(),
    speakingStates: {},
  });

  const [, prefActions] = usePreference();

  const getVolumeKey = (userId: number, mediaType: "voice" | "screenSound", callType: CallType = "channel") =>
    `volume:${userId}:${callType}:${mediaType}`;

  const actions: PlaybackActions = {
    getAudioContext() {
      return state.audio;
    },

    async resume() {
      await state.audio.resume();
    },

    getPlayback(userId, mediaType) {
      const key: PlaybackKey = `${userId}-${mediaType}`;
      return state.playbacks.get(key);
    },

    createPlayback(userId, mediaType, callType) {
      const key: PlaybackKey = `${userId}-${mediaType}`;
      const ctx = state.audio;

      let playback: AudioPlayback | VideoPlayback;

      switch (mediaType) {
        case "voice": {
          const pb = new AudioPlayback(ctx, 200);
          const vol = prefActions.get<number>(getVolumeKey(userId, "voice", callType)) ?? 100;
          pb.setVolume(vol);
          playback = pb;
          break;
        }
        case "screenSound": {
          const pb = new AudioPlayback(ctx, 200);
          const vol = prefActions.get<number>(getVolumeKey(userId, "screenSound", callType)) ?? 0;
          pb.setVolume(vol);
          playback = pb;
          break;
        }
        case "camera":
        case "screen":
          playback = new VideoPlayback(200);
          break;
      }

      setState("playbacks", (map) => new Map(map).set(key, playback));
      return playback;
    },

    destroyPlayback(userId, mediaType) {
      const key: PlaybackKey = `${userId}-${mediaType}`;
      const playback = state.playbacks.get(key);
      if (!playback) return;

      playback.cleanup();

      setState("playbacks", (map) => {
        const newMap = new Map(map);
        newMap.delete(key);
        return newMap;
      });
    },

    cleanupForUser(userId) {
      const mediaTypes: MediaTypeKey[] = ["voice", "camera", "screen", "screenSound"];
      for (const mediaType of mediaTypes) {
        actions.destroyPlayback(userId, mediaType);
      }
      actions.clearSpeakingState(userId);
    },

    streamMedia(userId, mediaType, packet, timestamp, sequence, callType) {
      let playback = actions.getPlayback(userId, mediaType);

      if (!playback) {
        playback = actions.createPlayback(userId, mediaType, callType);
      }

      if (mediaType === "voice" || mediaType === "screenSound") {
        (playback as AudioPlayback).pushChunk(packet as EncodedAudioChunk, timestamp);
      } else {
        (playback as VideoPlayback).pushFrame(packet as EncodedVideoChunk, timestamp, sequence);
      }
    },

    updateSpeakingState(userId, isSpeaking) {
      setState("speakingStates", userId, isSpeaking);
    },

    getSpeakingState(userId) {
      return state.speakingStates[userId] || false;
    },

    clearSpeakingState(userId) {
      setState("speakingStates", (states) => {
        const { [userId]: _, ...rest } = states;
        return rest;
      });
    },

    adjustVolume(userId, volume, callType) {
      prefActions.set(getVolumeKey(userId, "voice", callType), volume);
      const playback = actions.getPlayback(userId, "voice");
      if (playback) {
        (playback as AudioPlayback).setVolume(volume);
      }
    },

    getVolume(userId, callType) {
      const playback = actions.getPlayback(userId, "voice");
      if (playback) {
        return (playback as AudioPlayback).volume();
      }
      return prefActions.get<number>(getVolumeKey(userId, "voice", callType)) ?? 100;
    },

    adjustScreenAudio(userId, volume, callType) {
      prefActions.set(getVolumeKey(userId, "screenSound", callType), volume);
      const playback = actions.getPlayback(userId, "screenSound");
      if (playback) {
        (playback as AudioPlayback).setVolume(volume);
      }
    },

    getScreenAudioVolume(userId, callType) {
      const playback = actions.getPlayback(userId, "screenSound");
      if (playback) {
        return (playback as AudioPlayback).volume();
      }
      return prefActions.get<number>(getVolumeKey(userId, "screenSound", callType)) ?? 0;
    },
  };

  return [state, actions];
}

let instance: PlaybackStore | null = null;

export function usePlayback(): PlaybackStore {
  if (!instance) {
    createRoot(() => {
      instance = createPlaybackStore();
    });
  }
  return instance!;
}
