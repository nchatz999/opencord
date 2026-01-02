import { createSignal, createEffect } from 'solid-js';
import { MinHeap, timerManager } from 'opencord-utils';

interface BufferItem {
  timestamp: number;
  chunk: EncodedAudioChunk;
}


const AUDIO_WORKLET_CODE = `
class AudioBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.ringBuffer = new Float32Array(48000 * 2);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  handleMessage(event) {
    const { type, data } = event.data;
    switch (type) {
      case 'audioData':
        if (data) {
          
          for (let i = 0; i < data.length; i++) {
            this.ringBuffer[this.writeIndex] = data[i];
            this.writeIndex = (this.writeIndex + 1) % this.ringBuffer.length;

            
            if (this.available < this.ringBuffer.length) {
              this.available++;
            } else {
              
              this.readIndex = (this.readIndex + 1) % this.ringBuffer.length;
            }
          }
        }
        break;

      case 'clearBuffer':
        this.writeIndex = 0;
        this.readIndex = 0;
        this.available = 0;
        break;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const outputChannels = output.length;
    const bufferLength = output[0].length;

    
    for (let channel = 0; channel < outputChannels; channel++) {
      output[channel].fill(0);
    }

    
    if (this.available === 0) return true;

    const samplesToRead = Math.min(bufferLength, this.available);

    
    for (let i = 0; i < samplesToRead; i++) {
      const sample = this.ringBuffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.ringBuffer.length;

      for (let channel = 0; channel < outputChannels; channel++) {
        output[channel][i] = sample;
      }
    }

    this.available -= samplesToRead;

    return true;
  }
}

registerProcessor('audio-buffer-processor', AudioBufferProcessor);
`;


let workletInitialized = false;
let workletInitPromise: Promise<void> | null = null;


const DEFAULT_DECODER_CONFIG: AudioDecoderConfig = {
  codec: 'opus',
  sampleRate: 48000,
  numberOfChannels: 1,
};


async function ensureWorkletInitialized(context: AudioContext): Promise<void> {
  if (workletInitialized) return;

  if (workletInitPromise) {
    return workletInitPromise;
  }

  workletInitPromise = (async () => {
    const blob = new Blob([AUDIO_WORKLET_CODE], {
      type: "application/javascript",
    });
    const workletUrl = URL.createObjectURL(blob);

    try {
      await context.audioWorklet.addModule(workletUrl);
      workletInitialized = true;
    } catch (error) {
      workletInitPromise = null;
      throw error;
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  })();

  return workletInitPromise;
}

export class AudioPlayback {
  decoder: AudioDecoder;
  delay: number;
  buffer: MinHeap<BufferItem>;
  context: AudioContext;
  workletNode: AudioWorkletNode | null;
  gainNode: GainNode;
  bufferInterval: number | null;

  private getVolumeSignal: () => number;
  private setVolumeSignal: (value: number) => void;
  private getIsMutedSignal: () => boolean;
  private setIsMutedSignal: (value: boolean) => void;

  constructor(
    context: AudioContext,
    delay: number = 0,
    decoderConfig: AudioDecoderConfig = DEFAULT_DECODER_CONFIG,
  ) {
    this.delay = delay;
    this.context = context;
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
    this.workletNode = null;
    this.bufferInterval = null;


    const [getVolume, setVolume] = createSignal(100);
    const [getIsMuted, setIsMuted] = createSignal(false);

    this.getVolumeSignal = getVolume;
    this.setVolumeSignal = setVolume;
    this.getIsMutedSignal = getIsMuted;
    this.setIsMutedSignal = setIsMuted;

    createEffect(() => {
      if (this.getIsMutedSignal()) {
        this.gainNode.gain.setValueAtTime(0, this.context.currentTime);
      } else {
        const gainValue = this.getVolumeSignal() / 100;
        this.gainNode.gain.setValueAtTime(gainValue, this.context.currentTime);
      }
    });

    this.decoder = new AudioDecoder({
      output: (audioData) => {
        this.handleAudioData(audioData);
      },
      error: () => { },
    });
    this.decoder.configure(decoderConfig);
    this.buffer = new MinHeap<BufferItem>((a, b) => a.timestamp - b.timestamp);


    this.initialize();
  }

  async initialize() {
    try {

      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      await ensureWorkletInitialized(this.context);

      this.workletNode = new AudioWorkletNode(
        this.context,
        "audio-buffer-processor"
      );

      this.workletNode.connect(this.gainNode);


      this.bufferInterval = timerManager.setInterval(() => {
        this.processBuffer();
      }, 10);

    } catch (error) {
      console.error("Failed to initialize audio worklet:", error);
      throw error;
    }
  }

  handleAudioData(audioData: AudioData) {
    if (!this.workletNode) {
      audioData.close();
      return;
    }

    const audioSamples = new Float32Array(audioData.numberOfFrames);
    audioData.copyTo(audioSamples, { planeIndex: 0 });


    this.workletNode.port.postMessage({
      type: "audioData",
      data: audioSamples,
    });

    audioData.close();
  }

  pushChunk(chunk: EncodedAudioChunk, timestamp: number) {
    const presentationTime = timestamp + this.delay;
    this.buffer.insert({ timestamp: presentationTime, chunk });
  }

  processBuffer() {
    const now = Date.now();

    while (this.buffer.size() != 0) {
      const nextItem = this.buffer.peek();
      if (!nextItem || nextItem.timestamp > now) break;
      const item = this.buffer.extractMin();
      if (this.decoder.state === "configured" && item) this.decoder.decode(item.chunk);
    }
  }

  clearBuffer() {
    this.buffer = new MinHeap<BufferItem>((a, b) => a.timestamp - b.timestamp);

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "clearBuffer" });
    }

  }

  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(200, volume));
    this.setVolumeSignal(clampedVolume);
  }

  getVolume(): number {
    return this.getVolumeSignal();
  }

  volume(): number {
    return this.getVolumeSignal();
  }

  setMuted(muted: boolean): void {
    this.setIsMutedSignal(muted);
    if (muted) {
      this.gainNode.gain.setValueAtTime(0, this.context.currentTime);
    } else {
      const gainValue = this.getVolumeSignal() / 100;
      this.gainNode.gain.setValueAtTime(gainValue, this.context.currentTime);
    }

  }

  getMuted(): boolean {
    return this.getIsMutedSignal();
  }

  isMuted(): boolean {
    return this.getIsMutedSignal();
  }

  mute() {
    this.setMuted(true);
  }

  unmute() {
    this.setMuted(false);
  }

  toggleMute() {
    this.setMuted(!this.getMuted());
  }

  cleanup() {
    if (this.bufferInterval !== null) {
      timerManager.clearInterval(this.bufferInterval);
      this.bufferInterval = null;
    }

    this.clearBuffer();

    if (this.decoder.state !== 'closed') {
      this.decoder.close();
    }

    this.workletNode?.disconnect();
    this.gainNode.disconnect();
  }
}

export function createSharedAudioContext(): AudioContext {
  return new AudioContext({
    sampleRate: 48000,
    latencyHint: "interactive",
  });
}
