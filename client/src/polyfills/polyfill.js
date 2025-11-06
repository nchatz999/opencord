if (!self.MediaStreamTrackProcessor) {
  self.MediaStreamTrackProcessor = class MediaStreamTrackProcessor {
    constructor({ track }) {
      if (track.kind == "video") {
        this.readable = new ReadableStream({
          async start(controller) {
            track.addEventListener("ended", () => controller.close(), { once: true });
            this.video = document.createElement("video");
            this.video.srcObject = new MediaStream([track]);
            this.video.muted = true;
            this.video.playsInline = true;
            await Promise.all([
              this.video.play(),
              new Promise(r => this.video.onloadedmetadata = r)
            ]);
            this.track = track;
            this.videoFrameCallback = null;
          },
          async pull(controller) {
            if (track.readyState == "ended") return controller.close();
            await new Promise(resolve => {
              if (track.readyState == "ended") {
                controller.close();
                resolve();
                return;
              }
              // Using requestVideoFrameCallback for frame-perfect timing
              this.videoFrameCallback = this.video.requestVideoFrameCallback(
                async (now, metadata) => {
                  if (track.readyState == "ended") {
                    controller.close();
                    resolve();
                    return;
                  }
                  const bitmap = await createImageBitmap(this.video);
                  const timestamp = (metadata.mediaTime || (now / 1000)) * 1000000;
                  const videoFrame = new VideoFrame(bitmap, { timestamp });
                  controller.enqueue(videoFrame);
                  bitmap.close();
                  resolve();
                }
              );
            });
          },
          cancel() {
            if (this.videoFrameCallback) {
              this.video.cancelVideoFrameCallback(this.videoFrameCallback);
            }
            if (this.video) {
              this.video.pause();
              this.video.srcObject = null;
            }
          }
        });
      }
      else if (track.kind == "audio") {
        this.readable = new ReadableStream({
          async start(controller) {
            track.addEventListener("ended", () => controller.close(), { once: true });
            this.ac = new AudioContext;
            this.arrays = [];
            function worklet() {
              registerProcessor("mstp-shim", class Processor extends AudioWorkletProcessor {
                process(input) { this.port.postMessage(input); return true; }
              });
            }
            await this.ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);
            this.node = new AudioWorkletNode(this.ac, "mstp-shim");
            this.ac.createMediaStreamSource(new MediaStream([track])).connect(this.node);
            this.node.port.addEventListener("message", ({ data }) => data[0][0] && this.arrays.push(data));
            this.node.port.start();
          },
          async pull(controller) {
            if (track.readyState == "ended") return controller.close();
            while (!this.arrays.length) {
              await new Promise(r => this.node.port.onmessage = r);
              if (track.readyState == "ended") return controller.close();
            }
            const [channels] = this.arrays.shift();
            const joined = new Float32Array(channels.reduce((a, b) => a + b.length, 0));
            channels.reduce((offset, a) => (joined.set(a, offset), offset + a.length), 0);
            controller.enqueue(new AudioData({
              format: "f32-planar",
              sampleRate: this.ac.sampleRate,
              numberOfFrames: channels[0].length,
              numberOfChannels: channels.length,
              timestamp: this.ac.currentTime * 1e6 | 0,
              data: joined,
              transfer: [joined.buffer]
            }));
          }
        })
      }
    }
  }
};

if (!window.MediaStreamTrackGenerator) {
  window.MediaStreamTrackGenerator = class MediaStreamTrackGenerator {
    constructor({ kind }) {
      if (kind == "video") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext('2d', { desynchronized: true });
        const track = canvas.captureStream(30).getVideoTracks()[0];
        track.writable = new WritableStream({
          write(frame) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
            frame.close();
          }
        });
        return track;
      } else if (kind == "audio") {
        const ac = new AudioContext;
        const dest = ac.createMediaStreamDestination();
        const [track] = dest.stream.getAudioTracks();
        track.writable = new WritableStream({
          async start(controller) {
            this.arrays = [];
            function worklet() {
              registerProcessor("mstg-shim", class Processor extends AudioWorkletProcessor {
                constructor() {
                  super();
                  this.arrays = [];
                  this.arrayOffset = 0;
                  this.port.onmessage = ({ data }) => this.arrays.push(data);
                  this.emptyArray = new Float32Array(0);
                }
                process(inputs, [[output]]) {
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
            return track;
          },
          write(audioData) {
            const array = new Float32Array(audioData.numberOfFrames * audioData.numberOfChannels);
            audioData.copyTo(array, { planeIndex: 0 });
            this.node.port.postMessage(array, [array.buffer]);
            audioData.close();
          }
        });
        return track;
      }
    }
  };
}

