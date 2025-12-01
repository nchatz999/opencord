interface MediaStreamTrackGeneratorInit {
  kind: 'video' | 'audio';
}

interface MediaStreamTrackWithWritable extends MediaStreamTrack {
  writable: WritableStream<VideoFrame | AudioData>;
}

declare global {
  interface Window {
    MediaStreamTrackGenerator: {
      new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackWithWritable;
    };
  }
  
  var MediaStreamTrackGenerator: {
    new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackWithWritable;
  } | undefined;
}

if (!window.MediaStreamTrackGenerator) {
  window.MediaStreamTrackGenerator = class MediaStreamTrackGenerator {
    constructor({kind}: MediaStreamTrackGeneratorInit): MediaStreamTrackWithWritable {
      if (kind === "video") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext('2d', {desynchronized: true});
        
        if (!ctx) {
          throw new Error('Could not get canvas context');
        }
        
        const track = canvas.captureStream().getVideoTracks()[0] as MediaStreamTrackWithWritable;
        
        track.writable = new WritableStream({
          write(frame: VideoFrame) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
            frame.close();
          }
        });
        
        return track;
      } else if (kind === "audio") {
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        const [track] = dest.stream.getAudioTracks() as [MediaStreamTrackWithWritable];
        
        track.writable = new WritableStream({
          node: null as AudioWorkletNode | null,
          
          async start(controller) {
            function worklet() {
              registerProcessor("mstg-shim", class Processor extends AudioWorkletProcessor {
                private arrays: Float32Array[] = [];
                private array?: Float32Array;
                private arrayOffset = 0;
                private emptyArray = new Float32Array(0);
                
                constructor() {
                  super();
                  this.port.onmessage = ({data}: {data: Float32Array}) => this.arrays.push(data);
                }
                
                process(inputs: Float32Array[][], outputs: Float32Array[][][]) {
                  const [[output]] = outputs;
                  
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
            this.node = new AudioWorkletNode(ac, "mstg-shim");
            this.node.connect(dest);
          },
          
          write(audioData: AudioData) {
            const array = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
            audioData.copyTo(array, {planeIndex: 0});
            this.node!.port.postMessage(array, [array.buffer]);
            audioData.close();
          }
        });
        
        return track;
      } else {
        throw new Error(`Unsupported kind: ${kind}`);
      }
    }
  };
}

export default MediaStreamTrackGenerator;
