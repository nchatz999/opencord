import { createSignal, createRoot } from "solid-js";

const STORAGE_PREFIX = "opencord:";

type Serializable = string | number | boolean | null | Serializable[] | { [key: string]: Serializable };

interface PreferenceActions {
  get: <T extends Serializable>(key: string) => T | null;
  set: <T extends Serializable>(key: string, value: T) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export type PreferenceStore = [object, PreferenceActions];

function createPreferenceStore(): PreferenceStore {
  const [version, setVersion] = createSignal(0);

  const fullKey = (key: string) => `${STORAGE_PREFIX}${key}`;

  const actions: PreferenceActions = {
    get<T extends Serializable>(key: string): T | null {
      version();
      try {
        const stored = localStorage.getItem(fullKey(key));
        if (stored === null) return null;
        return JSON.parse(stored) as T;
      } catch {
        return null;
      }
    },

    set<T extends Serializable>(key: string, value: T): void {
      try {
        localStorage.setItem(fullKey(key), JSON.stringify(value));
        setVersion((v) => v + 1);
      } catch {}
    },

    remove(key: string): void {
      localStorage.removeItem(fullKey(key));
      setVersion((v) => v + 1);
    },

    clear(): void {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      setVersion((v) => v + 1);
    },
  };

  return [{}, actions];
}

let instance: PreferenceStore | null = null;

export function usePreference(): PreferenceStore {
  if (!instance) {
    createRoot(() => {
      instance = createPreferenceStore();
    });
  }
  return instance!;
}
