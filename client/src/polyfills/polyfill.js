class RingBuffer {
  constructor(size = 256) {
    this.buffer = new Array(size);
    this.head = 0;
    this.tail = 0;
    this.size = size;
    this.count = 0;
  }

  push(item) {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.size;

    if (this.count < this.size) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.size;
    }
  }

  shift() {
    if (this.count === 0) return undefined;

    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined; // Help GC
    this.head = (this.head + 1) % this.size;
    this.count--;
    return item;
  }

  isEmpty() {
    return this.count === 0;
  }

  get length() {
    return this.count;
  }
}

self.MediaStreamTrackProcessor = class MediaStreamTrackProcessor {
  constructor({ track, targetFPS = 60 }) {
    if (track.kind === "video") {
      this.frameInterval = 1000 / targetFPS;
      this.lastFrameTime = 0;
      this.pendingFrame = null;

      this.readable = new ReadableStream({
        start: async (controller) => {
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
          this.controller = controller;
          this.lastFrameTime = 0;
          this.pendingFrame = this.getNextFrame();
        },

        pull: async (controller) => {
          if (track.readyState === "ended") {
            return controller.close();
          }


          try {
            const framePromise = this.pendingFrame || this.getNextFrame();
            this.pendingFrame = this.getNextFrame();
            const videoFrame = await framePromise;

            if (videoFrame) {
              controller.enqueue(videoFrame);
              this.lastFrameTime = performance.now();
            }
          } catch (error) {
            console.error('Frame processing error:', error);
          }
        },

        cancel: () => {
          if (this.pendingFrame) {
            this.pendingFrame.then(frame => {
              if (frame) frame.close();
            }).catch(() => { });
          }

          if (this.video) {
            this.video.pause();
            this.video.srcObject = null;
          }
        }
      });

      this.getNextFrame = this.getNextFrame.bind(this);
    }
    else if (track.kind === "audio") {
      this.readable = new ReadableStream({
        async start(controller) {
          track.addEventListener("ended", () => controller.close(), { once: true });
          this.ac = new AudioContext();

          this.ringBuffer = new RingBuffer(256);

          function worklet() {
            registerProcessor("mstp-shim", class Processor extends AudioWorkletProcessor {
              process(input) {
                this.port.postMessage(input);
                return true;
              }
            });
          }

          await this.ac.audioWorklet.addModule(`data:text/javascript,(${worklet.toString()})()`);
          this.node = new AudioWorkletNode(this.ac, "mstp-shim");
          this.ac.createMediaStreamSource(new MediaStream([track])).connect(this.node);

          this.node.port.addEventListener("message", ({ data }) => {
            if (data[0][0]) this.ringBuffer.push(data);
          });
          this.node.port.start();
        },

        async pull(controller) {
          if (track.readyState === "ended") return controller.close();

          while (this.ringBuffer.isEmpty()) {
            await new Promise(r => this.node.port.onmessage = r);
            if (track.readyState === "ended") return controller.close();
          }

          const [channels] = this.ringBuffer.shift();

          const monoData = channels[0];

          controller.enqueue(new AudioData({
            format: "f32-planar",
            sampleRate: this.ac.sampleRate,
            numberOfFrames: monoData.length,
            numberOfChannels: 1, // Enforce mono
            timestamp: this.ac.currentTime * 1e6 | 0,
            data: monoData,
            transfer: [monoData.buffer]
          }));
        }
      });
    }
  }

  getNextFrame() {
    return new Promise((resolve, reject) => {
      if (this.track.readyState === "ended") {
        resolve(null);
        return;
      }


      this.video.requestVideoFrameCallback((now, metadata) => {
        if (this.track.readyState === "ended") {
          resolve(null);
          return;
        }

        try {
          const timestamp = (metadata.mediaTime || (now / 1000)) * 1000000;
          const videoFrame = new VideoFrame(this.video, { timestamp });
          resolve(videoFrame);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
};

window.MediaStreamTrackGenerator = class MediaStreamTrackGenerator {
  constructor({ kind }) {
    if (kind == "video") {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext('2d', { desynchronized: true });
      const track = canvas.captureStream(60).getVideoTracks()[0];

      let currentWidth = 0;
      let currentHeight = 0; track.writable = new WritableStream({
        write(frame) {
          if (currentWidth !== frame.displayWidth ||
            currentHeight !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
            currentWidth = frame.displayWidth;
            currentHeight = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        }
      }); return track;
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

