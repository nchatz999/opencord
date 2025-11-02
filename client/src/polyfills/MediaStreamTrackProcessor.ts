
declare global {
  interface Window {
    MediaStreamTrackProcessor: typeof MediaStreamTrackProcessor;
  }
}

export class MediaStreamTrackProcessorPolyfill {
  public readable: ReadableStream<VideoFrame | AudioData>;

  constructor(init: { track: MediaStreamTrack }) {
    const track = init.track;

    if (track.kind === "video") {
      this.readable = new ReadableStream({
        async start(controller) {
          track.addEventListener("ended", () => controller.close(), { once: true });


          const video = document.createElement("video");
          video.srcObject = new MediaStream([track]);


          await Promise.all([
            video.play(),
            new Promise(resolve => video.onloadedmetadata = resolve)
          ]);


          const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
          const ctx = canvas.getContext('2d', { desynchronized: true });

          if (!ctx) {
            throw new Error('Could not get OffscreenCanvas context');
          }


          (this as any).video = video;
          (this as any).canvas = canvas;
          (this as any).ctx = ctx;
          (this as any).t1 = performance.now();
        },

        async pull(controller) {
          if (track.readyState === "ended") return controller.close();

          const fps = track.getSettings().frameRate || 30;


          while (performance.now() - (this as any).t1 < 1000 / fps) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (track.readyState === "ended") return controller.close();
          }

          (this as any).t1 = performance.now();


          (this as any).ctx.drawImage((this as any).video, 0, 0);


          controller.enqueue(new VideoFrame((this as any).canvas, {
            timestamp: (this as any).t1 * 1000
          }));
        }
      });
    } else if (track.kind === "audio") {
      this.readable = new ReadableStream({
        async start(controller) {
          track.addEventListener("ended", () => controller.close(), { once: true });


          const ac = new AudioContext();
          const arrays: Float32Array[][] = [];


          function worklet() {
            registerProcessor("mstp-shim", class Processor extends AudioWorkletProcessor {
              process(input: Float32Array[][]) {
                this.port.postMessage(input);
                return true;
              }
            });
          }


          await ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);


          const node = new AudioWorkletNode(ac, "mstp-shim");
          ac.createMediaStreamSource(new MediaStream([track])).connect(node);


          node.port.addEventListener("message", ({ data }) => {
            if (data[0][0]) arrays.push(data);
          });
          node.port.start();


          (this as any).ac = ac;
          (this as any).arrays = arrays;
          (this as any).node = node;
        },

        async pull(controller) {
          if (track.readyState === "ended") return controller.close();


          while (!(this as any).arrays.length) {
            await new Promise(resolve => (this as any).node.port.onmessage = resolve);
            if (track.readyState === "ended") return controller.close();
          }

          const [channels] = (this as any).arrays.shift();


          const joined = new Float32Array(channels.reduce((a: number, b: Float32Array) => a + b.length, 0));
          channels.reduce((offset: number, a: Float32Array) => {
            joined.set(a, offset);
            return offset + a.length;
          }, 0);


          controller.enqueue(new AudioData({
            format: "f32-planar",
            sampleRate: (this as any).ac.sampleRate,
            numberOfFrames: channels[0].length,
            numberOfChannels: channels.length,
            timestamp: (this as any).ac.currentTime * 1e6 | 0,
            data: joined,
            transfer: [joined.buffer]
          }));
        }
      });
    }
  }
}


if (typeof window !== 'undefined' && !window.MediaStreamTrackProcessor) {
  window.MediaStreamTrackProcessor = MediaStreamTrackProcessorPolyfill as any;
}

export default MediaStreamTrackProcessorPolyfill;
