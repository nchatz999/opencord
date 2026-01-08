import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

interface OutputState {
  devices: AudioOutputDevice[];
  selectedDevice: AudioOutputDevice | null;
  deafened: boolean;
}

export interface OutputActions {
  getAvailableOutputs: () => AudioOutputDevice[];
  getSelectedOutput: () => AudioOutputDevice | null;
  setDeafened: (deafen: boolean) => void;
  getDeafened: () => boolean;
  setOutput: (device: AudioOutputDevice) => Promise<boolean>;
  getCurrentSinkId: () => string;
}

export type OutputStore = [OutputState, OutputActions];

function createOutputStore(): OutputStore {
  const [state, setState] = createStore<OutputState>({
    devices: [],
    selectedDevice: null,
    deafened: false,
  });

  const actions: OutputActions = {
    getAvailableOutputs() {
      return state.devices;
    },

    getSelectedOutput() {
      return state.selectedDevice;
    },

    setDeafened(deafen) {
      setState("deafened", deafen);
    },

    getDeafened() {
      return state.deafened;
    },

    async setOutput(device) {
      setState("selectedDevice", device);
      return true;
    },

    getCurrentSinkId() {
      return state.selectedDevice?.deviceId ?? "";
    },
  };

  return [state, actions];
}

let instance: OutputStore | null = null;

export function useOutput(): OutputStore {
  if (!instance) {
    createRoot(() => {
      instance = createOutputStore();
    });
  }
  return instance!;
}
