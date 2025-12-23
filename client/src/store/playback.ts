import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import { AudioPlayback, createSharedAudioContext } from "../lib/AudioPlayback";
import { VideoPlayback } from "../lib/VideoPlayback";
import { usePreference } from "./preference";

export type MediaTypeKey = "voice" | "camera" | "screen" | "screenSound";
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
  createPlayback: (userId: number, mediaType: MediaTypeKey) => AudioPlayback | VideoPlayback;
  destroyPlayback: (userId: number, mediaType: MediaTypeKey) => void;
  cleanupForUser: (userId: number) => void;
  streamMedia: (
    userId: number,
    mediaType: MediaTypeKey,
    packet: EncodedAudioChunk | EncodedVideoChunk,
    timestamp: number
  ) => void;
  updateSpeakingState: (userId: number, isSpeaking: boolean) => void;
  getSpeakingState: (userId: number) => boolean;
  clearSpeakingState: (userId: number) => void;
  adjustVolume: (userId: number, volume: number) => void;
  getVolume: (userId: number) => number;
  adjustScreenAudio: (userId: number, volume: number) => void;
  getScreenAudioVolume: (userId: number) => number;
}

export type PlaybackStore = [PlaybackStoreState, PlaybackActions];

function createPlaybackStore(): PlaybackStore {
  const [state, setState] = createStore<PlaybackStoreState>({
    audio: createSharedAudioContext(),
    playbacks: new Map(),
    speakingStates: {},
  });

  const [, prefActions] = usePreference();

  const getVolumeKey = (userId: number, mediaType: "voice" | "screenSound") =>
    `volume:${userId}:${mediaType}`;

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

    createPlayback(userId, mediaType) {
      const key: PlaybackKey = `${userId}-${mediaType}`;
      const ctx = state.audio;

      let playback: AudioPlayback | VideoPlayback;

      switch (mediaType) {
        case "voice": {
          const pb = new AudioPlayback(ctx, 200);
          const vol = prefActions.get<number>(getVolumeKey(userId, "voice")) ?? 100;
          pb.setVolume(vol);
          playback = pb;
          break;
        }
        case "screenSound": {
          const pb = new AudioPlayback(ctx, 200);
          const vol = prefActions.get<number>(getVolumeKey(userId, "screenSound")) ?? 0;
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

    streamMedia(userId, mediaType, packet, timestamp) {
      let playback = actions.getPlayback(userId, mediaType);

      if (!playback) {
        playback = actions.createPlayback(userId, mediaType);
      }

      if (mediaType === "voice" || mediaType === "screenSound") {
        (playback as AudioPlayback).pushChunk(packet as EncodedAudioChunk, timestamp);
      } else {
        (playback as VideoPlayback).pushFrame(packet as EncodedVideoChunk, timestamp);
      }
    },

    updateSpeakingState(userId, isSpeaking) {
      setState("speakingStates", userId, isSpeaking);
    },

    getSpeakingState(userId) {
      return state.speakingStates[userId] || false;
    },

    clearSpeakingState(userId) {
      setState(
        "speakingStates",
        produce((states) => {
          delete states[userId];
        })
      );
    },

    adjustVolume(userId, volume) {
      prefActions.set(getVolumeKey(userId, "voice"), volume);
      const playback = actions.getPlayback(userId, "voice");
      if (playback) {
        (playback as AudioPlayback).setVolume(volume);
      }
    },

    getVolume(userId) {
      const playback = actions.getPlayback(userId, "voice");
      if (playback) {
        return (playback as AudioPlayback).volume();
      }
      return prefActions.get<number>(getVolumeKey(userId, "voice")) ?? 100;
    },

    adjustScreenAudio(userId, volume) {
      prefActions.set(getVolumeKey(userId, "screenSound"), volume);
      const playback = actions.getPlayback(userId, "screenSound");
      if (playback) {
        (playback as AudioPlayback).setVolume(volume);
      }
    },

    getScreenAudioVolume(userId) {
      const playback = actions.getPlayback(userId, "screenSound");
      if (playback) {
        return (playback as AudioPlayback).volume();
      }
      return prefActions.get<number>(getVolumeKey(userId, "screenSound")) ?? 0;
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
