interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
}

interface MediaStreamTrackProcessorPolyfill {
  readable: ReadableStream<VideoFrame | AudioData>;
}

declare global {
  interface Window {
    MediaStreamTrackProcessor: {
      new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessorPolyfill;
    };
  }
  
  var MediaStreamTrackProcessor: {
    new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessorPolyfill;
  } | undefined;
}

if (!self.MediaStreamTrackProcessor) {
  self.MediaStreamTrackProcessor = class MediaStreamTrackProcessor {
    readable: ReadableStream<VideoFrame | AudioData>;
    
    constructor({track}: MediaStreamTrackProcessorInit) {
      if (track.kind === "video") {
        this.readable = new ReadableStream({
          video: null as HTMLVideoElement | null,
          canvas: null as OffscreenCanvas | null,
          ctx: null as OffscreenCanvasRenderingContext2D | null,
          t1: 0,
          
          async start(controller) {
            track.addEventListener("ended", () => controller.close(), {once: true});
            this.video = document.createElement("video");
            this.video.srcObject = new MediaStream([track]);
            await Promise.all([this.video.play(), new Promise(r => this.video!.onloadedmetadata = r)]);
            this.canvas = new OffscreenCanvas(this.video.videoWidth, this.video.videoHeight);
            this.ctx = this.canvas.getContext('2d', {desynchronized: true});
            this.t1 = performance.now();
          },
          
          async pull(controller) {
            if (track.readyState === "ended") return controller.close();
            const fps = track.getSettings().frameRate || 30;
            while (performance.now() - this.t1 < 1000 / fps) {
              await new Promise(r => requestAnimationFrame(r));
              if (track.readyState === "ended") return controller.close();
            }
            this.t1 = performance.now();
            this.ctx!.drawImage(this.video!, 0, 0);
            controller.enqueue(new VideoFrame(this.canvas!, {timestamp: this.t1}));
          }
        });
      } else if (track.kind === "audio") {
        this.readable = new ReadableStream({
          ac: null as AudioContext | null,
          arrays: [] as Float32Array[][][],
          node: null as AudioWorkletNode | null,
          
          async start(controller) {
            track.addEventListener("ended", () => controller.close(), {once: true});
            this.ac = new AudioContext();
            this.arrays = [];
            
            function worklet() {
              registerProcessor("mstp-shim", class Processor extends AudioWorkletProcessor {
                process(input: Float32Array[][]) { 
                  this.port.postMessage(input); 
                  return true; 
                }
              });
            }
            
            await this.ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);
            this.node = new AudioWorkletNode(this.ac, "mstp-shim");
            this.ac.createMediaStreamSource(new MediaStream([track])).connect(this.node);
            this.node.port.addEventListener("message", ({data}: {data: Float32Array[][]}) => {
              if (data[0][0]) this.arrays.push(data);
            });
          },
          
          async pull(controller) {
            if (track.readyState === "ended") return controller.close();
            while (!this.arrays.length) {
              await new Promise(r => this.node!.port.onmessage = r);
              if (track.readyState === "ended") return controller.close();
            }
            const [channels] = this.arrays.shift()!;
            const joined = new Float32Array(channels.reduce((a, b) => a + b.length, 0));
            channels.reduce((offset, a) => (joined.set(a, offset), offset + a.length), 0);
            controller.enqueue(new AudioData({
              format: "f32-planar",
              sampleRate: this.ac!.sampleRate,
              numberOfFrames: channels[0].length,
              numberOfChannels: channels.length,
              timestamp: this.ac!.currentTime * 1e6 | 0,
              data: joined,
              transfer: [joined.buffer]
            }));
          }
        });
      } else {
        throw new Error(`Unsupported track kind: ${track.kind}`);
      }
    }
  };
}

export default MediaStreamTrackProcessor;
