import { createSignal } from "solid-js";
import { MinHeap } from 'opencord-utils';

interface BufferItem {
  timestamp: number;
  frame: EncodedVideoChunk;
}

const DEFAULT_DECODER_CONFIG: VideoDecoderConfig = {
  codec: 'vp8',
};

export class VideoPlayback {
  decoder: VideoDecoder;
  hasReceivedKey: boolean = false;
  delay: number;
  buffer: MinHeap<BufferItem>;
  writer: WritableStreamDefaultWriter;
  stream: MediaStream;
  bufferInterval: number | null;
  private frameCount: number = 0;
  private lastFpsTime: number = Date.now();

  private getFpsSignal: () => number;
  private setFpsSignal: (value: number) => number;


  constructor(
    delay: number = 0,
    decoderConfig: VideoDecoderConfig = DEFAULT_DECODER_CONFIG
  ) {
    const [getFps, setFps] = createSignal<number>(0);
    this.getFpsSignal = getFps;
    this.setFpsSignal = setFps;

    this.delay = delay;
    this.decoder = new VideoDecoder({
      output: async (frame) => {
        await this.writer.write(frame);
      },
      error: (e) => console.error('Video decoder error:', e)
    });

    this.decoder.configure(decoderConfig);

    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = generator.writable.getWriter();
    this.stream = new MediaStream([generator]);
    this.buffer = new MinHeap<BufferItem>((a, b) => a.timestamp - b.timestamp);


    this.bufferInterval = window.setInterval(() => {
      this.processBuffer();
    }, 10);
  }

  pushFrame(frame: EncodedVideoChunk, timestamp: number) {
    const presentationTime = timestamp + this.delay;
    this.buffer.insert({ timestamp: presentationTime, frame });
  }

  processBuffer() {
    if (this.decoder.state !== 'configured') return;

    const now = Date.now();

    while (this.buffer.size() != 0) {
      const nextItem = this.buffer.peek();
      if (!nextItem || nextItem.timestamp > now) break;

      const item = this.buffer.extractMin()!;
      try {
        if (item.frame.type == "key") this.hasReceivedKey = true
        if (this.hasReceivedKey) {
          this.decoder.decode(item.frame);
          this.frameCount++;
          this.updateFPS();
        }
      } catch (error) {
        console.error('Failed to decode video frame:', error);
      }
    }
  }

  private updateFPS() {
    const now = Date.now();
    const elapsed = (now - this.lastFpsTime) / 1000;

    if (elapsed >= 1) {
      const newFps = Math.round(this.frameCount / elapsed);
      this.setFpsSignal(newFps);
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  resetTimestamps() {
    this.hasReceivedKey = false;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.setFpsSignal(0);
  }

  clearBuffer() {
    this.buffer = new MinHeap<BufferItem>((a, b) => a.timestamp - b.timestamp);
    this.resetTimestamps();
  }

  getStream(): MediaStream {
    return this.stream;
  }

  getFPS() {
    return this.getFpsSignal;
  }

  cleanup() {

    if (this.bufferInterval !== null) {
      window.clearInterval(this.bufferInterval);
      this.bufferInterval = null;
    }

    this.clearBuffer();

    this.hasReceivedKey = false

    if (this.writer) {
      try {
        this.writer.close();
      } catch (error) {
        console.error('Error closing video writer:', error);
      }
    }

    if (this.decoder.state !== 'closed') {
      try {
        this.decoder.close();
      } catch (error) {
        console.error('Error closing video decoder:', error);
      }
    }


    this.stream.getTracks().forEach(track => track.stop());
  }
}

