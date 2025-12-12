import { createSignal, onCleanup } from "solid-js";
import { usePlayback } from "../store/index";

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}


export class OutputManager {
  private getDevicesSignal: () => AudioOutputDevice[];
  private setDevicesSignal: (devices: AudioOutputDevice[]) => void;
  private getSelectedDeviceSignal: () => AudioOutputDevice | null;
  private setSelectedDeviceSignal: (device: AudioOutputDevice | null) => void;
  private getDeafenedSignal: () => boolean;
  private setDeafenedSignal: (deafen: boolean) => void;

  private gainNode: GainNode;
  private audioContext: AudioContext;

  constructor() {
    const [devices, setDevices] = createSignal<AudioOutputDevice[]>([]);
    const [selectedDevice, setSelectedDevice] = createSignal<AudioOutputDevice | null>(null);
    const [deafened, setDeafened] = createSignal<boolean>(false);

    this.getDevicesSignal = devices;
    this.setDevicesSignal = setDevices;
    this.getSelectedDeviceSignal = selectedDevice;
    this.setSelectedDeviceSignal = setSelectedDevice;
    this.getDeafenedSignal = deafened
    this.setDeafenedSignal = setDeafened

    const [, playbackActions] = usePlayback();
    this.audioContext = playbackActions.getAudioContext();
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);



    this.loadDevices();


    navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);

    onCleanup(() => {
      navigator.mediaDevices.removeEventListener('devicechange', this.handleDeviceChange);
    });
  }

  private handleDeviceChange = () => {
    this.loadDevices();
  };

  private async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Audio Output ${device.deviceId.slice(0, 8)}`,
          groupId: device.groupId,
        }));

      this.setDevicesSignal(audioOutputs);


      if (!this.getSelectedDeviceSignal() && audioOutputs.length > 0) {
        this.setSelectedDeviceSignal(audioOutputs[0]);
      }
    } catch (error) {
      console.error('Failed to enumerate audio output devices:', error);
    }
  }

  getAvailableOutputs(): AudioOutputDevice[] {
    return this.getDevicesSignal();
  }

  getSelectedOutput(): AudioOutputDevice | null {
    return this.getSelectedDeviceSignal();
  }

  setDeafened(deafen: boolean) {

    if (deafen) {
      this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    } else {
      this.gainNode.gain.setValueAtTime(1, this.audioContext.currentTime);
    }
    this.setDeafenedSignal(deafen)
  }

  getDeafened(): boolean {
    return this.getDeafenedSignal()
  }

  async setOutput(device: AudioOutputDevice): Promise<boolean> {
    try {

      if ('setSinkId' in this.audioContext && typeof this.audioContext.setSinkId === 'function') {
        await this.audioContext.setSinkId(device.deviceId);
        this.setSelectedDeviceSignal(device);
        return true;
      } else {
        console.warn('AudioContext.setSinkId is not supported in this browser');
        return false;
      }
    } catch (error) {
      console.error('Failed to set audio output device:', error);
      return false;
    }
  }


  getCurrentSinkId(): string {
    if ('sinkId' in this.audioContext) {
      return this.audioContext.sinkId as string;
    }
    return '';
  }
}


