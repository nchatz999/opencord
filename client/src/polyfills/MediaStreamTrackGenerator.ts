
declare global {
  interface Window {
    MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator;
  }
}

export class MediaStreamTrackGeneratorPolyfill {
  constructor(init: { kind: 'video' | 'audio' }) {
    if (init.kind === "video") {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext('2d', { desynchronized: true });
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
      
      const track = canvas.captureStream().getVideoTracks()[0];
      
      
      (track as any).writable = new WritableStream({
        write(frame: VideoFrame) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        }
      });
      
      return track;
    } else if (init.kind === "audio") {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      const [track] = dest.stream.getAudioTracks();
      
      
      (track as any).writable = new WritableStream({
        async start(controller) {
          const arrays: Float32Array[] = [];
          
          
          function worklet() {
            registerProcessor("mstg-shim", class Processor extends AudioWorkletProcessor {
              private arrays: Float32Array[] = [];
              private array?: Float32Array;
              private arrayOffset = 0;
              private emptyArray = new Float32Array(0);
              
              constructor() {
                super();
                this.port.onmessage = ({ data }) => this.arrays.push(data);
              }
              
              process(inputs: Float32Array[][], outputs: Float32Array[][][]) {
                const [output] = outputs[0];
                
                for (let i = 0; i < output.length; i++) {
                  if (!this.array || this.arrayOffset >= this.array.length) {
                    this.array = this.arrays.shift() || this.emptyArray;
                    this.arrayOffset = 0;
                  }
                  output[i] = this.array[this.arrayOffset++] || 0;
                }
                return true;
              }
            });
          }
          
          
          await ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);
          const node = new AudioWorkletNode(ac, "mstg-shim");
          node.connect(dest);
          
          
          (this as any).node = node;
          
          return track;
        },
        
        write(audioData: AudioData) {
          const array = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
          audioData.copyTo(array, { planeIndex: 0 });
          (this as any).node.port.postMessage(array, [array.buffer]);
          audioData.close();
        }
      });
      
      return track;
    }
  }
}


if (typeof window !== 'undefined' && !window.MediaStreamTrackGenerator) {
  window.MediaStreamTrackGenerator = MediaStreamTrackGeneratorPolyfill as any;
}

export default MediaStreamTrackGeneratorPolyfill;
