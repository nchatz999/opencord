import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { usePreference } from "./preference";
import { Track, type RemoteTrack, type RemoteAudioTrack } from "livekit-client";

type Key = `${number}:${Track.Source}`;
type AudioSource = Track.Source.Microphone | Track.Source.ScreenShareAudio;

interface AudioEntry {
  track: RemoteAudioTrack;
  volume: number;
}

interface PlaybackState {
  tracks: Record<Key, RemoteTrack>;
  audio: Record<Key, AudioEntry>;
  speaking: Record<number, boolean>;
}

interface PlaybackActions {
  attachTrack: (userId: number, source: Track.Source, track: RemoteTrack) => void;
  detachTrack: (userId: number, source: Track.Source) => void;
  getTrack: (userId: number, source: Track.Source) => RemoteTrack | undefined;
  isSubscribedToVideo: (userId: number, source: Track.Source.Camera | Track.Source.ScreenShare) => boolean;
  cleanupForUser: (userId: number) => void;
  updateSpeakingState: (userId: number, isSpeaking: boolean) => void;
  getSpeakingState: (userId: number) => boolean;
  setVolume: (userId: number, volume: number) => void;
  getVolume: (userId: number) => number;
  setScreenVolume: (userId: number, volume: number) => void;
  getScreenVolume: (userId: number) => number;
}

export type PlaybackStore = [PlaybackState, PlaybackActions];

const SOURCES = [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare, Track.Source.ScreenShareAudio];
const DEFAULT_VOLUME: Record<AudioSource, number> = {
  [Track.Source.Microphone]: 100,
  [Track.Source.ScreenShareAudio]: 100,
};

function createPlaybackStore(): PlaybackStore {
  const [state, setState] = createStore<PlaybackState>({
    tracks: {},
    audio: {},
    speaking: {},
  });

  const [, pref] = usePreference();

  const toKey = (userId: number, source: Track.Source): Key => `${userId}:${source}`;
  const prefKey = (userId: number, source: AudioSource) => `vol:${userId}:${source}`;

  const loadVolume = (userId: number, source: AudioSource): number => {
    return pref.get<number>(prefKey(userId, source)) ?? DEFAULT_VOLUME[source];
  };

  const updateVolume = (userId: number, source: AudioSource, volume: number) => {
    const k = toKey(userId, source);
    const entry = state.audio[k];
    if (entry) {
      pref.set(prefKey(userId, source), volume);
      entry.track.setVolume(volume / 100);
      setState("audio", k, { ...entry, volume });
    }
  };

  const readVolume = (userId: number, source: AudioSource): number => {
    return state.audio[toKey(userId, source)]?.volume ?? DEFAULT_VOLUME[source];
  };

  const actions: PlaybackActions = {
    attachTrack(userId, source, track) {
      const k = toKey(userId, source);
      actions.detachTrack(userId, source);
      setState("tracks", k, track);

      if (source === Track.Source.Microphone || source === Track.Source.ScreenShareAudio) {
        const audioTrack = track as RemoteAudioTrack;
        const volume = loadVolume(userId, source);
        audioTrack.setVolume(volume / 100);
        audioTrack.attach();
        setState("audio", k, { track: audioTrack, volume });
      }
    },

    detachTrack(userId, source) {
      const k = toKey(userId, source);
      const entry = state.audio[k];
      if (entry) {
        entry.track.detach();
      }
      state.tracks[k]?.detach();
      setState("tracks", k, undefined!);
      setState("audio", k, undefined!);
    },

    getTrack: (userId, source) => state.tracks[toKey(userId, source)],
    isSubscribedToVideo: (userId, source) => !!state.tracks[toKey(userId, source)],

    cleanupForUser(userId) {
      SOURCES.forEach((s) => actions.detachTrack(userId, s));
      setState("speaking", userId, undefined!);
    },

    updateSpeakingState: (userId, isSpeaking) => setState("speaking", userId, isSpeaking),
    getSpeakingState: (userId) => state.speaking[userId] ?? false,

    setVolume: (userId, volume) => updateVolume(userId, Track.Source.Microphone, volume),
    getVolume: (userId) => readVolume(userId, Track.Source.Microphone),
    setScreenVolume: (userId, volume) => updateVolume(userId, Track.Source.ScreenShareAudio, volume),
    getScreenVolume: (userId) => readVolume(userId, Track.Source.ScreenShareAudio),
  };

  return [state, actions];
}

let instance: PlaybackStore | null = null;

export function usePlayback(): PlaybackStore {
  if (!instance) {
    createRoot(() => { instance = createPlaybackStore(); });
  }
  return instance!;
}
