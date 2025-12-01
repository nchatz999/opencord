import { createSignal } from 'solid-js';
import { createVADNode } from './Vad';

export interface MicrophoneConstraints {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface EncoderConfig {
  codec?: string;
  sampleRate?: number;
  numberOfChannels?: number;
  bitrate?: number;
}

export class Microphone {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private processor: MediaStreamTrackProcessor<AudioData> | null = null;
  private encoder: AudioEncoder | null = null;
  private reader: ReadableStreamDefaultReader<AudioData> | null = null;
  private isProcessing = false;

  private getVolumeSignal: () => number;
  private setVolumeSignal: (value: number) => number;
  private getDeviceIdSignal: () => string;
  private setDeviceIdSignal: (value: string) => string;
  private getIsRecordingSignal: () => boolean;
  private setIsRecordingSignal: (value: boolean) => boolean;
  private getMutedSignal: () => boolean;
  private setMutedSignal: (muted: boolean) => void;
  private getAvailableInputsSignal: () => MediaDeviceInfo[];
  private setAvailableInputsSignal: (devices: MediaDeviceInfo[]) => MediaDeviceInfo[];
  private getQualitySignal: () => number;
  private setQualitySignal: (value: number) => number;

  private constraints: MicrophoneConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  };

  private encoderConfig: EncoderConfig = {
    codec: 'opus',
    sampleRate: 48000,
    numberOfChannels: 1,
    bitrate: 128000,
  };

  private encodedDataCallback: (chunk: EncodedAudioChunk) => void = () => { };
  private speechCallback: (isSpeech: boolean) => void = () => { };

  constructor(encoderConfig?: EncoderConfig) {
    if (encoderConfig) {
      this.encoderConfig = { ...this.encoderConfig, ...encoderConfig };
    }


    const [getVolume, setVolume] = createSignal<number>(100.0);
    this.getVolumeSignal = getVolume;
    this.setVolumeSignal = setVolume;

    const [getDeviceId, setDeviceId] = createSignal<string>('');
    this.getDeviceIdSignal = getDeviceId;
    this.setDeviceIdSignal = setDeviceId;

    const [getIsRecording, setIsRecording] = createSignal<boolean>(false);
    this.getIsRecordingSignal = getIsRecording;
    this.setIsRecordingSignal = setIsRecording;

    const [getMuted, setMuted] = createSignal(false)
    this.setMutedSignal = setMuted;
    this.getMutedSignal = getMuted;

    const [getAvailableInputs, setAvailableInputs] = createSignal<MediaDeviceInfo[]>([]);
    this.getAvailableInputsSignal = getAvailableInputs;
    this.setAvailableInputsSignal = setAvailableInputs;

    const [getQuality, setQuality] = createSignal<number>(128000);
    this.getQualitySignal = getQuality;
    this.setQualitySignal = setQuality;


    this.initializeDeviceList();
    this.setupDeviceChangeListener();
  }

  private async initializeDeviceList(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      this.setAvailableInputsSignal(audioInputs);
    } catch (error) {
      console.error('Error initializing device list:', error);
    }
  }

  private setupDeviceChangeListener(): void {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      await this.updateAvailableDevices();
    });
  }

  private async updateAvailableDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      this.setAvailableInputsSignal(audioInputs);
    } catch (error) {
      console.error('Error updating available devices:', error);
    }
  }

  listDevices(): MediaDeviceInfo[] {
    return this.getAvailableInputsSignal();
  }

  async setDevice(deviceId: string): Promise<void> {
    this.setDeviceIdSignal(deviceId);


    if (this.getIsRecordingSignal()) {
      await this.stop();
      await this.start();
    }
  }

  getDevice() {
    return this.getDeviceIdSignal()
  }

  setVolume(volume: number): void {

    const clampedVolume = Math.max(0, Math.min(200, volume));
    this.setVolumeSignal(volume);

    if (this.gainNode) {
      this.gainNode.gain.value = clampedVolume;
    }
  }

  getVolume(): number {
    return this.getVolumeSignal();
  }

  setQuality(quality: number): void {
    this.setQualitySignal(quality);
    if (this.encoder && this.encoder.state === 'configured') {
      this.encoder.configure({
        ...this.encoderConfig,
        bitrate: quality
      });
    }
  }

  getQuality(): number {
    return this.getQualitySignal();
  }

  setMuted(muted: boolean) {
    this.setMutedSignal(muted)
  }

  getMuted(): boolean {
    return this.getMutedSignal()
  }


  isRecording(): boolean {
    return this.getIsRecordingSignal();
  }

  setConstraints(constraints: Partial<MicrophoneConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  getConstraints(): MicrophoneConstraints {
    return { ...this.constraints };
  }


  onEncodedData(callback: (chunk: EncodedAudioChunk) => void) {
    this.encodedDataCallback = callback
  }

  onSpeech(callback: (isSpeech: boolean) => void) {
    this.speechCallback = callback
  }

  async start(): Promise<void> {
    if (this.getIsRecordingSignal()) {
      console.warn('Already recording');
      return;
    }

    try {
      const mediaConstraints: MediaStreamConstraints = {
        audio: {
          deviceId: this.getDeviceIdSignal() ? { exact: this.getDeviceIdSignal() } : undefined,
          echoCancellation: this.constraints.echoCancellation,
          noiseSuppression: this.constraints.noiseSuppression,
          autoGainControl: this.constraints.autoGainControl,
          sampleRate: this.constraints.sampleRate,
          channelCount: this.constraints.channelCount,
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      this.audioContext = new AudioContext({
        sampleRate: this.constraints.sampleRate,
      });

      const vad = await createVADNode(this.audioContext, 'sensitive');

      const source = this.audioContext.createMediaStreamSource(this.stream);
      const destination = this.audioContext.createMediaStreamDestination();
      source.connect(vad.getInput());

      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.getVolumeSignal() / 100;
      vad.connect(this.gainNode);
      this.gainNode.connect(destination);

      vad.addEventListener('speechstart', () => {
        if (!this.getMuted())
          this.speechCallback(true)
      });
      vad.addEventListener('speechend', () => {
        this.speechCallback(false)
      })

      const audioTrack = destination.stream.getAudioTracks()[0];
      audioTrack.onended = () => this.stop();
      this.processor = new MediaStreamTrackProcessor({ track: audioTrack });
      this.setupEncoder();


      this.isProcessing = true;
      this.processAudioStream();


      await this.updateAvailableDevices();

      this.setIsRecordingSignal(true);
    } catch (error) {
      console.error('Error starting microphone:', error);
      await this.cleanup();
      throw error;
    }
  }

  private setupEncoder(): void {
    this.encoder = new AudioEncoder({
      output: (chunk, _metadata) => {
        if (!this.getMuted()) this.encodedDataCallback(chunk);
      },
      error: (error) => {
        console.error('Encoder error:', error);
      },
    });

    this.encoder.configure(this.encoderConfig as AudioEncoderConfig);
  }

  private async processAudioStream(): Promise<void> {
    if (!this.processor) return;

    this.reader = this.processor.readable.getReader();

    try {
      while (this.isProcessing) {
        const { done, value } = await this.reader.read();
        if (done) break;
        if (value) {

          if (this.encoder && this.encoder.state === 'configured') {
            if (value.numberOfChannels === 2 && this.encoderConfig.numberOfChannels === 1) {
              const buffer = new ArrayBuffer(value.numberOfFrames * 4);
              value.copyTo(buffer, { planeIndex: 0 });
              const monoData = new AudioData({
                format: value.format,
                sampleRate: value.sampleRate,
                numberOfFrames: value.numberOfFrames,
                numberOfChannels: 1,
                timestamp: value.timestamp,
                data: buffer,
              });

              this.encoder.encode(monoData);
            } else {
              this.encoder.encode(value)
            }
          }
          value.close();
        }
      }
    } catch (error) {
      if (this.isProcessing) {
        console.error('Error processing audio stream:', error);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.getIsRecordingSignal()) {
      return;
    }
    this.isProcessing = false;
    if (this.encoder && this.encoder.state === 'configured') {
      await this.encoder.flush();
    }
    await this.cleanup();
    this.setIsRecordingSignal(false);
  }

  private async cleanup(): Promise<void> {

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (e) {

      }
      this.reader = null;
    }


    if (this.encoder) {
      if (this.encoder.state !== 'closed') {
        this.encoder.close();
      }
      this.encoder = null;
    }


    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }


    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.gainNode = null;
    this.processor = null;
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.encodedDataCallback = () => { };
  }
}
