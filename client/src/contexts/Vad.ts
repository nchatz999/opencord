



interface VADParams {
  energyThreshold: number;
  silenceDuration: number;
  attackTime: number;
  releaseTime: number;
  smoothingFactor: number;
}

interface VADPreset extends VADParams {
  description: string;
}

interface VADOptions extends Partial<VADParams> {
  preset?: PresetName;
  onGateOpen?: (data: GateEventData) => void;
  onGateClosed?: (data: GateEventData) => void;
  onStatus?: (status: StatusData) => void;
}

interface GateEventData {
  energy: number;
}

interface StatusData {
  isSpeaking: boolean;
  energy: number;
  gain: number;
}

interface CalibrationResult {
  noiseFloor: number;
  recommendedThreshold: number;
  suggestedPreset: PresetName;
}

type PresetName = 'sensitive' | 'default' | 'moderate' | 'quiet' | 'veryQuiet';





const VAD_PROCESSOR_CODE = `
class VADGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.energyThreshold = 0.015;
    this.silenceDuration = 400;
    this.attackTime = 30;
    this.releaseTime = 150;
    this.smoothingFactor = 0.95;
    
    this.isSpeaking = false;
    this.silenceStart = null;
    this.currentGain = 0;
    this.targetGain = 0;
    this.smoothedEnergy = 0;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'updateParams') {
        Object.assign(this, event.data.params);
      }
    };
  }
  
  calculateEnergy(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }
  
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input[0] || !output || !output[0]) {
      return true;
    }
    
    const inputChannel = input[0];
    const outputChannel = output[0];
    const bufferLength = inputChannel.length;
    const sampleRate = 48000;
    
    const rawEnergy = this.calculateEnergy(inputChannel);
    this.smoothedEnergy = this.smoothingFactor * this.smoothedEnergy + 
                          (1 - this.smoothingFactor) * rawEnergy;
    
    const hasVoice = this.smoothedEnergy > this.energyThreshold;
    const now = currentTime * 1000;
    
    if (hasVoice) {
      this.silenceStart = null;
      if (!this.isSpeaking) {
        this.isSpeaking = true;
        this.targetGain = 1;
        this.port.postMessage({ type: 'gateOpen', energy: this.smoothedEnergy });
      }
    } else {
      if (this.isSpeaking) {
        if (this.silenceStart === null) {
          this.silenceStart = now;
        } else if (now - this.silenceStart >= this.silenceDuration) {
          this.isSpeaking = false;
          this.targetGain = 0;
          this.port.postMessage({ type: 'gateClosed', energy: this.smoothedEnergy });
        }
      }
    }
    
    const attackSamples = (this.attackTime / 1000) * sampleRate;
    const releaseSamples = (this.releaseTime / 1000) * sampleRate;
    const fadeSpeed = this.targetGain > this.currentGain ? 
                      1 / attackSamples : 
                      1 / releaseSamples;
    
    for (let i = 0; i < bufferLength; i++) {
      if (this.currentGain !== this.targetGain) {
        if (Math.abs(this.targetGain - this.currentGain) < fadeSpeed) {
          this.currentGain = this.targetGain;
        } else {
          this.currentGain += (this.targetGain > this.currentGain ? fadeSpeed : -fadeSpeed);
        }
      }
      
      outputChannel[i] = inputChannel[i] * this.currentGain;
    }
    
    if (Math.random() < 0.01) {
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

registerProcessor('vad-gate-processor', VADGateProcessor);
`;





export class VADGate {
  
  static readonly PRESETS: Record<PresetName, VADPreset> = {
    sensitive: {
      energyThreshold: 0.008,
      silenceDuration: 300,
      attackTime: 20,
      releaseTime: 120,
      smoothingFactor: 0.95,
      description: 'For quiet speakers or quiet environments'
    },

    default: {
      energyThreshold: 0.015,
      silenceDuration: 400,
      attackTime: 30,
      releaseTime: 150,
      smoothingFactor: 0.95,
      description: 'Balanced settings for most users'
    },

    moderate: {
      energyThreshold: 0.02,
      silenceDuration: 450,
      attackTime: 35,
      releaseTime: 180,
      smoothingFactor: 0.95,
      description: 'Good for slightly noisy environments'
    },

    quiet: {
      energyThreshold: 0.025,
      silenceDuration: 500,
      attackTime: 40,
      releaseTime: 200,
      smoothingFactor: 0.96,
      description: 'For noisy environments'
    },

    veryQuiet: {
      energyThreshold: 0.035,
      silenceDuration: 550,
      attackTime: 50,
      releaseTime: 250,
      smoothingFactor: 0.96,
      description: 'Maximum noise rejection'
    }
  };

  private audioContext: AudioContext;
  public node: AudioWorkletNode | null = null;
  private initialized: boolean = false;
  private params: VADParams;

  
  private onGateOpen: ((data: GateEventData) => void) | null;
  private onGateClosed: ((data: GateEventData) => void) | null;
  private onStatus: ((status: StatusData) => void) | null;

  constructor(audioContext: AudioContext, options: VADOptions = {}) {
    this.audioContext = audioContext;

    
    const preset = options.preset ? VADGate.PRESETS[options.preset] : VADGate.PRESETS.default;

    
    this.params = {
      energyThreshold: options.energyThreshold ?? preset.energyThreshold,
      silenceDuration: options.silenceDuration ?? preset.silenceDuration,
      attackTime: options.attackTime ?? preset.attackTime,
      releaseTime: options.releaseTime ?? preset.releaseTime,
      smoothingFactor: options.smoothingFactor ?? preset.smoothingFactor,
    };

    
    this.onGateOpen = options.onGateOpen ?? null;
    this.onGateClosed = options.onGateClosed ?? null;
    this.onStatus = options.onStatus ?? null;
  }

  async init(): Promise<AudioWorkletNode> {
    if (this.initialized && this.node) {
      return this.node;
    }

    try {
      
      const blob = new Blob([VAD_PROCESSOR_CODE], { type: 'application/javascript' });
      const processorURL = URL.createObjectURL(blob);

      
      await this.audioContext.audioWorklet.addModule(processorURL);

      
      URL.revokeObjectURL(processorURL);

      
      this.node = new AudioWorkletNode(this.audioContext, 'vad-gate-processor');

      
      this.node.port.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      
      this.updateParams(this.params);

      this.initialized = true;
      return this.node;
    } catch (error) {
      console.error('Failed to initialize VAD Gate:', error);
      throw error;
    }
  }

  private handleMessage(message: any): void {
    const { type, ...data } = message;

    switch (type) {
      case 'gateOpen':
        this.onGateOpen?.(data as GateEventData);
        break;
      case 'gateClosed':
        this.onGateClosed?.(data as GateEventData);
        break;
      case 'status':
        this.onStatus?.(data as StatusData);
        break;
    }
  }

  updateParams(params: Partial<VADParams>): void {
    Object.assign(this.params, params);
    if (this.node) {
      this.node.port.postMessage({
        type: 'updateParams',
        params: this.params
      });
    }
  }

  setPreset(presetName: PresetName): void {
    const preset = VADGate.PRESETS[presetName];
    if (!preset) {
      throw new Error(`Preset "${presetName}" not found`);
    }

    const { description, ...params } = preset;
    this.updateParams(params);
  }

  setThreshold(threshold: number): void {
    this.updateParams({ energyThreshold: threshold });
  }

  setSilenceDuration(duration: number): void {
    this.updateParams({ silenceDuration: duration });
  }

  setAttackTime(time: number): void {
    this.updateParams({ attackTime: time });
  }

  setReleaseTime(time: number): void {
    this.updateParams({ releaseTime: time });
  }

  async calibrate(stream: MediaStream, duration: number = 3000): Promise<CalibrationResult> {
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);
    const samples: number[] = [];
    const startTime = Date.now();

    return new Promise((resolve) => {
      const measure = (): void => {
        analyser.getFloatTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        samples.push(rms);

        if (Date.now() - startTime < duration) {
          requestAnimationFrame(measure);
        } else {
          source.disconnect();

          samples.sort((a, b) => a - b);
          const avgNoise = samples.slice(0, Math.floor(samples.length * 0.7))
            .reduce((a, b) => a + b, 0) / (samples.length * 0.7);

          const recommendedThreshold = Math.max(avgNoise * 2.5, 0.008);

          
          let suggestedPreset: PresetName = 'default';
          if (recommendedThreshold < 0.012) suggestedPreset = 'sensitive';
          else if (recommendedThreshold < 0.018) suggestedPreset = 'default';
          else if (recommendedThreshold < 0.023) suggestedPreset = 'moderate';
          else if (recommendedThreshold < 0.03) suggestedPreset = 'quiet';
          else suggestedPreset = 'veryQuiet';

          const result: CalibrationResult = {
            noiseFloor: avgNoise,
            recommendedThreshold,
            suggestedPreset
          };

          
          this.setPreset(suggestedPreset);
          resolve(result);
        }
      };

      measure();
    });
  }

  connect(destination: AudioNode): this {
    if (!this.node) {
      throw new Error('VADGate not initialized. Call init() first.');
    }
    this.node.connect(destination);
    return this;
  }

  disconnect(): this {
    this.node?.disconnect();
    return this;
  }

  getParams(): VADParams {
    return { ...this.params };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  destroy(): void {
    this.disconnect();
    this.node = null;
    this.initialized = false;
  }
}
