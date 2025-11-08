interface VADNodeOptions {
  threshold?: number;
  minSpeechDuration?: number;
  minSilenceDuration?: number;
  attackTime?: number;
  releaseTime?: number;
  analysisFPS?: number;
  debug?: boolean;
  smoothingFactor?: number;
}

interface VADEventMap {
  'speechstart': CustomEvent<{ timestamp: number; energy: number }>;
  'speechend': CustomEvent<{ timestamp: number; duration: number }>;
  'statechange': CustomEvent<{ state: 'active' | 'inactive'; timestamp: number }>;
  'energyupdate': CustomEvent<{ energy: number; threshold: number }>;
}

type VADEventListener<K extends keyof VADEventMap> = (event: VADEventMap[K]) => void;

class VADNode extends EventTarget {
  private context: AudioContext;
  private input: GainNode;
  private output: GainNode;
  private analyser: AnalyserNode;
  private processor: ScriptProcessorNode | AudioWorkletNode | null = null;

  private options: Required<VADNodeOptions>;

  private isActive: boolean = false;
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private silenceStartTime: number = 0;
  private lastActivityTime: number = 0;

  private analyserBuffer: Float32Array;
  private energyHistory: number[] = [];
  private readonly historySize: number = 10;

  private animationFrameId: number | null = null;
  private isDestroyed: boolean = false;

  constructor(context: AudioContext, options: VADNodeOptions = {}) {
    super();

    this.context = context;

    this.options = {
      threshold: 0.01,
      minSpeechDuration: 50,
      minSilenceDuration: 200,
      attackTime: 10,
      releaseTime: 100,
      analysisFPS: 120,
      debug: false,
      smoothingFactor: 0.95,
      ...options
    };

    this.input = context.createGain();
    this.output = context.createGain();
    this.analyser = context.createAnalyser();

    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = this.options.smoothingFactor;

    this.analyserBuffer = new Float32Array(this.analyser.fftSize);

    this.setupAudioGraph();

    this.startAnalysis();

    if (this.options.debug) {
      console.log('VADNode initialized with options:', this.options);
    }
  }

  private setupAudioGraph(): void {
    this.input.connect(this.analyser);

    this.input.connect(this.output);

    this.output.gain.value = 0;
  }

  private startAnalysis(): void {
    const analyse = () => {
      if (this.isDestroyed) return;

      this.performAnalysis();

      const delay = 1000 / this.options.analysisFPS;
      this.animationFrameId = window.setTimeout(() => {
        requestAnimationFrame(analyse);
      }, delay);
    };

    analyse();
  }

  private performAnalysis(): void {
    this.analyser.getFloatTimeDomainData(this.analyserBuffer);

    const energy = this.calculateEnergy(this.analyserBuffer);
    const zcr = this.calculateZeroCrossingRate(this.analyserBuffer);

    this.energyHistory.push(energy);
    if (this.energyHistory.length > this.historySize) {
      this.energyHistory.shift();
    }

    const adaptiveThreshold = this.calculateAdaptiveThreshold();

    const isSpeechDetected = this.detectSpeech(energy, zcr, adaptiveThreshold);

    this.updateState(isSpeechDetected, energy);

    if (this.options.debug) {
      this.emitEvent('energyupdate', {
        energy,
        threshold: adaptiveThreshold
      });
    }
  }

  private calculateEnergy(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }

  private calculateZeroCrossingRate(buffer: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < buffer.length; i++) {
      if ((buffer[i] >= 0) !== (buffer[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / buffer.length;
  }

  private calculateAdaptiveThreshold(): number {
    if (this.energyHistory.length === 0) {
      return this.options.threshold;
    }

    const avg = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const dynamicThreshold = avg * 1.5;

    return Math.max(this.options.threshold, Math.min(dynamicThreshold, this.options.threshold * 3));
  }

  private detectSpeech(energy: number, zcr: number, threshold: number): boolean {
    const energyCheck = energy > threshold;
    const zcrCheck = zcr > 0.01 && zcr < 0.1;

    return energyCheck && zcrCheck;
  }

  private updateState(isSpeechDetected: boolean, energy: number): void {
    const now = performance.now();

    if (isSpeechDetected) {
      this.lastActivityTime = now;

      if (!this.isSpeaking) {
        if (this.speechStartTime === 0) {
          this.speechStartTime = now;
        } else if (now - this.speechStartTime >= this.options.minSpeechDuration) {
          this.onSpeechStart(energy);
        }
      }
      this.silenceStartTime = 0;
    } else {
      if (this.isSpeaking) {
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime >= this.options.minSilenceDuration) {
          this.onSpeechEnd();
        }
      } else {
        this.speechStartTime = 0;
      }
    }
  }

  private onSpeechStart(energy: number): void {
    this.isSpeaking = true;
    this.setActive(true);

    this.emitEvent('speechstart', {
      timestamp: performance.now(),
      energy
    });

    if (this.options.debug) {
      console.log('Speech started with energy:', energy);
    }
  }

  private onSpeechEnd(): void {
    const duration = performance.now() - this.speechStartTime;

    this.isSpeaking = false;
    this.setActive(false);
    this.speechStartTime = 0;
    this.silenceStartTime = 0;

    this.emitEvent('speechend', {
      timestamp: performance.now(),
      duration
    });

    if (this.options.debug) {
      console.log('Speech ended. Duration:', duration, 'ms');
    }
  }

  private setActive(active: boolean): void {
    if (this.isActive === active) return;

    this.isActive = active;

    const targetGain = active ? 1 : 0;
    const time = active ? this.options.attackTime : this.options.releaseTime;

    this.output.gain.cancelScheduledValues(this.context.currentTime);
    this.output.gain.setTargetAtTime(
      targetGain,
      this.context.currentTime,
      time / 1000
    );

    this.emitEvent('statechange', {
      state: active ? 'active' : 'inactive',
      timestamp: performance.now()
    });
  }

  private emitEvent<K extends keyof VADEventMap>(
    type: K,
    detail: VADEventMap[K]['detail']
  ): void {
    const event = new CustomEvent(type, { detail });
    this.dispatchEvent(event);
  }

  addEventListener<K extends keyof VADEventMap>(
    type: K,
    listener: VADEventListener<K>,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, listener as EventListener, options);
  }

  removeEventListener<K extends keyof VADEventMap>(
    type: K,
    listener: VADEventListener<K>,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, listener as EventListener, options);
  }

  updateOptions(options: Partial<VADNodeOptions>): void {
    this.options = { ...this.options, ...options };

    if (options.smoothingFactor !== undefined) {
      this.analyser.smoothingTimeConstant = options.smoothingFactor;
    }

    if (this.options.debug) {
      console.log('VADNode options updated:', options);
    }
  }

  getCurrentEnergy(): number {
    this.analyser.getFloatTimeDomainData(this.analyserBuffer);
    return this.calculateEnergy(this.analyserBuffer);
  }

  getState(): {
    isActive: boolean;
    isSpeaking: boolean;
    energy: number;
    threshold: number;
  } {
    return {
      isActive: this.isActive,
      isSpeaking: this.isSpeaking,
      energy: this.getCurrentEnergy(),
      threshold: this.calculateAdaptiveThreshold()
    };
  }

  connect(destination: AudioNode | AudioParam): AudioNode {
    if (destination instanceof AudioParam) {
      this.output.connect(destination);
      return this.output;
    }
    return this.output.connect(destination);
  }

  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.output.disconnect(destination as any);
    } else {
      this.output.disconnect();
    }
  }

  get inputNode(): AudioNode {
    return this.input;
  }

  get outputNode(): AudioNode {
    return this.output;
  }

  destroy(): void {
    this.isDestroyed = true;

    if (this.animationFrameId !== null) {
      clearTimeout(this.animationFrameId);
    }

    this.input.disconnect();
    this.output.disconnect();
    this.analyser.disconnect();

    this.energyHistory = [];

    if (this.options.debug) {
      console.log('VADNode destroyed');
    }
  }
}

export function createVADNode(
  context: AudioContext,
  options?: VADNodeOptions
): VADNode {
  return new VADNode(context, options);
}


