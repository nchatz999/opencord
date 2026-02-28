const WORKLET_NAME = "energy-vad";

const workletCode = `class EnergyVadWorklet extends AudioWorkletProcessor {
  #speaking = false;
  #lastSpeechTime = 0;
  #smoothedRms = 0;
  #noiseFloor = 0;

  static RMS_ALPHA = 0.3;
  static NOISE_ALPHA = 0.01;
  static SPEECH_RATIO_ON = 3.0;
  static SPEECH_RATIO_OFF = 2.0;
  static MIN_FLOOR = 0.0001;
  static SILENCE_GRACE = 0.15;

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);

    this.#smoothedRms += EnergyVadWorklet.RMS_ALPHA * (rms - this.#smoothedRms);

    if (!this.#speaking) {
      this.#noiseFloor += EnergyVadWorklet.NOISE_ALPHA * (this.#smoothedRms - this.#noiseFloor);
    }
    const floor = Math.max(this.#noiseFloor, EnergyVadWorklet.MIN_FLOOR);

    const ratio = this.#speaking
      ? EnergyVadWorklet.SPEECH_RATIO_OFF
      : EnergyVadWorklet.SPEECH_RATIO_ON;

    if (this.#smoothedRms > floor * ratio) this.#lastSpeechTime = currentTime;

    const speaking = currentTime - this.#lastSpeechTime < EnergyVadWorklet.SILENCE_GRACE;

    if (speaking !== this.#speaking) {
      this.#speaking = speaking;
      this.port.postMessage(speaking);
    }

    return true;
  }
}
registerProcessor('${WORKLET_NAME}', EnergyVadWorklet);`;

const workletUrl = URL.createObjectURL(
  new Blob([workletCode], { type: "application/javascript" })
);

export class EnergyVad {
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;

  async start(
    track: MediaStreamTrack,
    callback: (speaking: boolean) => void
  ): Promise<void> {
    await this.stop();

    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl);

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const worklet = new AudioWorkletNode(ctx, WORKLET_NAME);

    worklet.port.onmessage = (e) => callback(e.data);
    source.connect(worklet);

    this.audioContext = ctx;
    this.sourceNode = source;
    this.workletNode = worklet;
  }

  async stop(): Promise<void> {
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    await this.audioContext?.close();
    this.audioContext = this.sourceNode = this.workletNode = undefined;
  }
}
