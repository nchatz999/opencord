import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { usePreference } from "./preference";

interface SoundState {
  volume: number;
  enabled: boolean;
}

interface SoundActions {
  play: (file: string) => void;
  setVolume: (volume: number) => void;
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  getVolume: () => number;
}

export type SoundStore = [SoundState, SoundActions];

function createSoundStore(): SoundStore {
  const [, prefActions] = usePreference();

  const [state, setState] = createStore<SoundState>({
    volume: prefActions.get<number>("sound:volume") ?? 50,
    enabled: prefActions.get<boolean>("sound:enabled") ?? true,
  });

  const actions: SoundActions = {
    play(file: string) {
      if (!state.enabled) return;

      const audio = new Audio(file);
      audio.volume = state.volume / 100;
      audio.play().catch(() => {});
    },

    setVolume(volume: number) {
      setState("volume", volume);
      prefActions.set("sound:volume", volume);
    },

    setEnabled(enabled: boolean) {
      setState("enabled", enabled);
      prefActions.set("sound:enabled", enabled);
    },

    isEnabled() {
      return state.enabled;
    },

    getVolume() {
      return state.volume;
    },
  };

  return [state, actions];
}

let instance: SoundStore | null = null;

export function useSound(): SoundStore {
  if (!instance) {
    createRoot(() => {
      instance = createSoundStore();
    });
  }
  return instance!;
}
