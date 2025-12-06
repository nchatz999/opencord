const VAD_PROCESSOR_CODE = `
class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.isSpeaking = false;
    this.smoothedEnergy = 0;
    this.hangoverCounter = 0;
    
    this.threshold = 0.01;
    this.smoothingFactor = 0.92;
    this.hangoverFrames = 10;
    this.minSpeechFrames = 5;
    this.speechFrameCounter = 0;
    
    this.gateAttack = 0.01;
    this.gateRelease = 0.1;
    this.currentGain = 0;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'updateParams') {
        Object.assign(this, event.data.params);
      }
    };
  }
  
  calculateRMS(inputBuffer) {
    let sum = 0;
    for (let i = 0; i < inputBuffer.length; i++) {
      sum += inputBuffer[i] * inputBuffer[i];
    }
    return Math.sqrt(sum / inputBuffer.length);
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || input.length === 0) {
      return true;
    }
    
    const currentEnergy = this.calculateRMS(input[0]);
    
    this.smoothedEnergy = this.smoothingFactor * this.smoothedEnergy + 
                          (1 - this.smoothingFactor) * currentEnergy;
    
    const isCurrentlySpeaking = this.smoothedEnergy > this.threshold;
    
    if (isCurrentlySpeaking) {
      this.speechFrameCounter++;
      this.hangoverCounter = this.hangoverFrames;
      
      if (!this.isSpeaking && this.speechFrameCounter >= this.minSpeechFrames) {
        this.isSpeaking = true;
        this.port.postMessage({ type: 'speechStart', energy: this.smoothedEnergy });
      }
    } else {
      this.speechFrameCounter = 0;
      
      if (this.isSpeaking) {
        if (this.hangoverCounter > 0) {
          this.hangoverCounter--;
        } else {
          this.isSpeaking = false;
          this.port.postMessage({ type: 'speechEnd', energy: this.smoothedEnergy });
        }
      }
    }
    
    const targetGain = this.isSpeaking ? 1 : 0;
    const rate = targetGain > this.currentGain ? this.gateAttack : this.gateRelease;
    this.currentGain += (targetGain - this.currentGain) * rate;
    

    if (input[0] && output[0]) {
      for (let i = 0; i < input[0].length; i++) {
        output[0][i] = input[0][i] * this.currentGain;
      }
    }
      
    if (currentTime % 0.1 < 0.01) { 
      this.port.postMessage({
        type: 'status',
        isSpeaking: this.isSpeaking,
        energy: this.smoothedEnergy,
        gain: this.currentGain
      });
    }
    
    return true;
  }
}

registerProcessor('vad-processor', VADProcessor);
`;

export interface VADConfig {
  threshold?: number;
  smoothingFactor?: number;
  hangoverTime?: number;
  minSpeechDuration?: number;
  gateAttack?: number;
  gateRelease?: number;
}

export const VADPresets = {
  sensitive: {
    threshold: 0.005,
    smoothingFactor: 0.95,
    hangoverTime: 300,
    minSpeechDuration: 50,
    gateAttack: 0.005,
    gateRelease: 0.2
  },
  normal: {
    threshold: 0.01,
    smoothingFactor: 0.92,
    hangoverTime: 200,
    minSpeechDuration: 150,
    gateAttack: 0.01,
    gateRelease: 0.1
  },
  aggressive: {
    threshold: 0.02,
    smoothingFactor: 0.88,
    hangoverTime: 100,
    minSpeechDuration: 200,
    gateAttack: 0.02,
    gateRelease: 0.05
  }
} as const;

export interface VADStatus {
  isSpeaking: boolean;
  energy: number;
  gain: number;
}

export class VADNode {
  private context: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private input: GainNode;
  private output: GainNode;
  private config: Required<VADConfig>;
  private isInitialized: boolean = false;

  public onSpeechStart: ((event: { energy: number; timestamp: number }) => void) | null = null;
  public onSpeechEnd: ((event: { energy: number; timestamp: number }) => void) | null = null;
  public onStatusUpdate: ((status: VADStatus) => void) | null = null;

  private eventListeners: Map<string, Set<Function>> = new Map();

  constructor(audioContext: AudioContext, config: VADConfig = {}) {
    this.context = audioContext;

    this.config = {
      threshold: config.threshold ?? 0.01,
      smoothingFactor: config.smoothingFactor ?? 0.92,
      hangoverTime: config.hangoverTime ?? 200,
      minSpeechDuration: config.minSpeechDuration ?? 150,
      gateAttack: config.gateAttack ?? 0.01,
      gateRelease: config.gateRelease ?? 0.1
    };

    this.input = this.context.createGain();
    this.output = this.context.createGain();

    this.eventListeners.set('speechstart', new Set());
    this.eventListeners.set('speechend', new Set());
    this.eventListeners.set('statusupdate', new Set());
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const blob = new Blob([VAD_PROCESSOR_CODE], { type: 'application/javascript' });
      const processorUrl = URL.createObjectURL(blob);

      await this.context.audioWorklet.addModule(processorUrl);

      this.workletNode = new AudioWorkletNode(this.context, 'vad-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers'
      });

      this.workletNode.port.onmessage = this.handleProcessorMessage.bind(this);

      this.input.connect(this.workletNode);
      this.workletNode.connect(this.output);

      this.updateProcessorParams();

      URL.revokeObjectURL(processorUrl);

      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize VAD Node: ${error}`);
    }
  }

  private handleProcessorMessage(event: MessageEvent): void {
    const { type, energy, isSpeaking, gain } = event.data;
    const timestamp = this.context.currentTime;

    switch (type) {
      case 'speechStart':
        const startEvent = { energy, timestamp };
        this.onSpeechStart?.(startEvent);
        this.emit('speechstart', startEvent);
        break;

      case 'speechEnd':
        const endEvent = { energy, timestamp };
        this.onSpeechEnd?.(endEvent);
        this.emit('speechend', endEvent);
        break;

      case 'status':
        const status: VADStatus = { isSpeaking, energy, gain };
        this.onStatusUpdate?.(status);
        this.emit('statusupdate', status);
        break;
    }
  }

  private updateProcessorParams(): void {
    if (!this.workletNode) return;

    const sampleRate = this.context.sampleRate;
    const frameSize = 128;

    this.workletNode.port.postMessage({
      type: 'updateParams',
      params: {
        threshold: this.config.threshold,
        smoothingFactor: this.config.smoothingFactor,
        hangoverFrames: Math.floor(this.config.hangoverTime * sampleRate / (frameSize * 1000)),
        minSpeechFrames: Math.floor(this.config.minSpeechDuration * sampleRate / (frameSize * 1000)),
        gateAttack: this.config.gateAttack,
        gateRelease: this.config.gateRelease
      }
    });
  }

  public setConfig(config: Partial<VADConfig>): void {
    Object.assign(this.config, config);
    this.updateProcessorParams();
  }

  public applyPreset(preset: keyof typeof VADPresets): void {
    this.setConfig(VADPresets[preset]);
  }

  public getConfig(): Required<VADConfig> {
    return { ...this.config };
  }

  public connect(destination: AudioNode | AudioParam): AudioNode {
    return this.output.connect(destination as any);
  }

  public disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.output.disconnect(destination as any);
    } else {
      this.output.disconnect();
    }
  }

  public getInput(): AudioNode {
    return this.input;
  }

  public getOutput(): AudioNode {
    return this.output;
  }

  public addEventListener(event: string, listener: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.add(listener);
    }
  }

  public removeEventListener(event: string, listener: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  private emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }

  public dispose(): void {
    this.disconnect();
    this.input.disconnect();

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.close();
      this.workletNode = null;
    }

    this.eventListeners.clear();
    this.isInitialized = false;
  }
}

export async function createVADNode(
  audioContext: AudioContext,
  config?: VADConfig | keyof typeof VADPresets
): Promise<VADNode> {
  const vadConfig = typeof config === 'string' ? VADPresets[config] : config;
  const vadNode = new VADNode(audioContext, vadConfig);
  await vadNode.initialize();
  return vadNode;
}


