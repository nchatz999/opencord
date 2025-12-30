import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { usePlayback } from "./playback";

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

  const [, playbackActions] = usePlayback();
  const audioContext = playbackActions.getAudioContext();
  const gainNode = audioContext.createGain();
  gainNode.connect(audioContext.destination);

  const loadDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices
        .filter((device) => device.kind === "audiooutput")
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio Output ${device.deviceId.slice(0, 8)}`,
          groupId: device.groupId,
        }));

      setState("devices", audioOutputs);

      if (!state.selectedDevice && audioOutputs.length > 0) {
        setState("selectedDevice", audioOutputs[0]);
      }
    } catch (error) {
      console.error("Failed to enumerate audio output devices:", error);
    }
  };

  const handleDeviceChange = () => {
    loadDevices();
  };

  loadDevices();
  navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

  const actions: OutputActions = {
    getAvailableOutputs() {
      return state.devices;
    },

    getSelectedOutput() {
      return state.selectedDevice;
    },

    setDeafened(deafen) {
      if (deafen) {
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      } else {
        gainNode.gain.setValueAtTime(1, audioContext.currentTime);
      }
      setState("deafened", deafen);
    },

    getDeafened() {
      return state.deafened;
    },

    async setOutput(device) {
      try {
        if ("setSinkId" in audioContext && typeof audioContext.setSinkId === "function") {
          await audioContext.setSinkId(device.deviceId);
          setState("selectedDevice", device);
          return true;
        } else {
          console.warn("AudioContext.setSinkId is not supported in this browser");
          return false;
        }
      } catch (error) {
        console.error("Failed to set audio output device:", error);
        return false;
      }
    },

    getCurrentSinkId() {
      if ("sinkId" in audioContext) {
        return audioContext.sinkId as string;
      }
      return "";
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
