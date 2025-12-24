/// <reference types="vite/client" />

export {};

interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
}

interface ElectronAPI {
  getScreenSources: () => Promise<ScreenSource[]>;
  onShowScreenPicker: (callback: (sources: ScreenSource[]) => void) => void;
  selectScreen: (sourceId: string | null) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
