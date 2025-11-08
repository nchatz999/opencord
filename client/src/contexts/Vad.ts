
class VadProcessor extends AudioWorkletProcessor {
  private threshold = 0.01;
  private smoothingFactor = 0.95;
  private smoothedEnergy = 0;
  private isSpeaking = false;
  private silenceFrames = 0;
  private speechFrames = 0;
  private minSpeechFrames = 5;
  private minSilenceFrames = 10;

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: any) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];
    let energy = 0;
    
    for (let i = 0; i < inputChannel.length; i++) {
      energy += inputChannel[i] * inputChannel[i];
    }
    energy = Math.sqrt(energy / inputChannel.length);
    
    this.smoothedEnergy = this.smoothingFactor * this.smoothedEnergy + (1 - this.smoothingFactor) * energy;
    
    const isVoice = this.smoothedEnergy > this.threshold;
    
    if (isVoice) {
      this.speechFrames++;
      this.silenceFrames = 0;
      
      if (!this.isSpeaking && this.speechFrames >= this.minSpeechFrames) {
        this.isSpeaking = true;
        this.port.postMessage({ type: 'speechStart' });
      }
    } else {
      this.silenceFrames++;
      this.speechFrames = 0;
      
      if (this.isSpeaking && this.silenceFrames >= this.minSilenceFrames) {
        this.isSpeaking = false;
        this.port.postMessage({ type: 'speechEnd' });
      }
    }
    
    if (this.isSpeaking) {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].set(input[channel]);
      }
    } else {
      for (let channel = 0; channel < output.length; channel++) {
        output[channel].fill(0);
      }
    }
    
    return true;
  }
}

registerProcessor('vad-processor', VadProcessor);

export interface VadNodeOptions {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  threshold?: number;
}

export class VadNode {
  private audioContext: AudioContext;
  private workletNode: AudioWorkletNode | null = null;
  private onSpeechStart?: () => void;
  private onSpeechEnd?: () => void;

  constructor(audioContext: AudioContext, options: VadNodeOptions = {}) {
    this.audioContext = audioContext;
    this.onSpeechStart = options.onSpeechStart;
    this.onSpeechEnd = options.onSpeechEnd;
  }

  async initialize(): Promise<void> {
    const workletCode = `
      class VadProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.threshold = 0.01;
          this.smoothingFactor = 0.95;
          this.smoothedEnergy = 0;
          this.isSpeaking = false;
          this.silenceFrames = 0;
          this.speechFrames = 0;
          this.minSpeechFrames = 5;
          this.minSilenceFrames = 10;
        }

        process(inputs, outputs, parameters) {
          const input = inputs[0];
          const output = outputs[0];
          
          if (!input || !input[0]) {
            return true;
          }

          const inputChannel = input[0];
          let energy = 0;
          
          for (let i = 0; i < inputChannel.length; i++) {
            energy += inputChannel[i] * inputChannel[i];
          }
          energy = Math.sqrt(energy / inputChannel.length);
          
          this.smoothedEnergy = this.smoothingFactor * this.smoothedEnergy + (1 - this.smoothingFactor) * energy;
          
          const isVoice = this.smoothedEnergy > this.threshold;
          
          if (isVoice) {
            this.speechFrames++;
            this.silenceFrames = 0;
            
            if (!this.isSpeaking && this.speechFrames >= this.minSpeechFrames) {
              this.isSpeaking = true;
              this.port.postMessage({ type: 'speechStart' });
            }
          } else {
            this.silenceFrames++;
            this.speechFrames = 0;
            
            if (this.isSpeaking && this.silenceFrames >= this.minSilenceFrames) {
              this.isSpeaking = false;
              this.port.postMessage({ type: 'speechEnd' });
            }
          }
          
          if (this.isSpeaking) {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel].set(input[channel]);
            }
          } else {
            for (let channel = 0; channel < output.length; channel++) {
              output[channel].fill(0);
            }
          }
          
          return true;
        }
      }

      registerProcessor('vad-processor', VadProcessor);
    `;

    const blob = new Blob([workletCode], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    
    await this.audioContext.audioWorklet.addModule(workletUrl);
    
    this.workletNode = new AudioWorkletNode(this.audioContext, 'vad-processor');
    
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'speechStart' && this.onSpeechStart) {
        this.onSpeechStart();
      } else if (event.data.type === 'speechEnd' && this.onSpeechEnd) {
        this.onSpeechEnd();
      }
    };
    
    URL.revokeObjectURL(workletUrl);
  }

  connect(destination: AudioNode): AudioNode {
    if (!this.workletNode) {
      throw new Error('VadNode not initialized');
    }
    this.workletNode.connect(destination);
    return this.workletNode;
  }

  disconnect(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
  }

  getNode(): AudioWorkletNode {
    if (!this.workletNode) {
      throw new Error('VadNode not initialized');
    }
    return this.workletNode;
  }
}
