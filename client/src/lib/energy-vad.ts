const workletCode = `
class EnergyVadWorklet extends AudioWorkletProcessor {
    constructor() {
        super();
        this.speaking = false;
        this.lastSpeechTime = 0;
    }

    process(inputs) {
        const input = inputs[0]?.[0];
        if (!input) return true;

        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);

        if (rms > 0.01) this.lastSpeechTime = currentTime;

        const isSpeaking = (currentTime - this.lastSpeechTime) < 0.25;
        if (isSpeaking !== this.speaking) {
            this.speaking = isSpeaking;
            this.port.postMessage(isSpeaking);
        }

        return true;
    }
}
registerProcessor('energy-vad', EnergyVadWorklet);
`;

const blob = new Blob([workletCode], { type: "application/javascript" });
const workletUrl = URL.createObjectURL(blob);

export class EnergyVad {
    private audioContext?: AudioContext;
    private sourceNode?: MediaStreamAudioSourceNode;
    private workletNode?: AudioWorkletNode;

    async start(track: MediaStreamTrack, callback: (speaking: boolean) => void): Promise<void> {
        await this.stop();
        this.audioContext = new AudioContext();
        await this.audioContext.audioWorklet.addModule(workletUrl);

        this.sourceNode = this.audioContext.createMediaStreamSource(new MediaStream([track]));
        this.workletNode = new AudioWorkletNode(this.audioContext, "energy-vad");
        this.workletNode.port.onmessage = (e) => callback(e.data);

        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
    }

    async stop(): Promise<void> {
        this.sourceNode?.disconnect();
        this.workletNode?.disconnect();
        await this.audioContext?.close();
        this.sourceNode = undefined;
        this.workletNode = undefined;
        this.audioContext = undefined;
    }
}
