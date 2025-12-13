import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import { AudioPlayback, createSharedAudioContext } from "../lib/AudioPlayback";
import { VideoPlayback } from "../lib/VideoPlayback";

export interface PlaybackState {
  playback: AudioPlayback;
  screenPlayback: VideoPlayback;
  cameraPlayback: VideoPlayback;
  screenSoundPlayback: AudioPlayback;
}

interface PlaybackStoreState {
  audio: AudioContext;
  playbackStates: Record<number, PlaybackState>;
  speakingStates: Record<number, boolean>;
}

interface PlaybackActions {
  getAudioContext: () => AudioContext;
  resume: () => Promise<void>;
  getPlaybackState: (userId: number) => PlaybackState | undefined;
  initializeForUser: (userId: number) => void;
  cleanupForUser: (userId: number) => void;
  streamMedia: (
    userId: number,
    mediaType: "voice" | "screen" | "camera" | "screenSound",
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
    playbackStates: {},
    speakingStates: {},
  });

  const actions: PlaybackActions = {
    getAudioContext() {
      return state.audio;
    },

    async resume() {
      await state.audio.resume();
    },

    getPlaybackState(userId) {
      return state.playbackStates[userId];
    },

    initializeForUser(userId) {
      if (state.playbackStates[userId]) return;

      const playbackState: PlaybackState = {
        playback: new AudioPlayback(actions.getAudioContext(), 200),
        screenPlayback: new VideoPlayback(200),
        cameraPlayback: new VideoPlayback(200),
        screenSoundPlayback: new AudioPlayback(actions.getAudioContext(), 200),
      };
      playbackState.screenSoundPlayback.setVolume(0);

      setState("playbackStates", userId, playbackState);
    },

    cleanupForUser(userId) {
      setState(
        "playbackStates",
        produce((states) => {
          delete states[userId];
        })
      );
      actions.clearSpeakingState(userId);
    },

    streamMedia(userId, mediaType, packet, timestamp) {
      const playbackState = actions.getPlaybackState(userId);
      if (!playbackState) return;

      switch (mediaType) {
        case "voice":
          playbackState.playback.pushChunk(packet as EncodedAudioChunk, timestamp);
          break;
        case "screen":
          playbackState.screenPlayback.pushFrame(packet as EncodedVideoChunk, timestamp);
          break;
        case "camera":
          playbackState.cameraPlayback.pushFrame(packet as EncodedVideoChunk, timestamp);
          break;
        case "screenSound":
          playbackState.screenSoundPlayback.pushChunk(packet as EncodedAudioChunk, timestamp);
          break;
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
      const playbackState = actions.getPlaybackState(userId);
      if (playbackState?.playback) {
        playbackState.playback.setVolume(volume);
      }
    },

    getVolume(userId) {
      const playbackState = actions.getPlaybackState(userId);
      if (playbackState?.playback) {
        return playbackState.playback.volume();
      }
      return 100;
    },

    adjustScreenAudio(userId, volume) {
      const playbackState = actions.getPlaybackState(userId);
      if (playbackState?.screenSoundPlayback) {
        playbackState.screenSoundPlayback.setVolume(volume);
      }
    },

    getScreenAudioVolume(userId) {
      const playbackState = actions.getPlaybackState(userId);
      if (playbackState?.screenSoundPlayback) {
        return playbackState.screenSoundPlayback.volume();
      }
      return 100;
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
