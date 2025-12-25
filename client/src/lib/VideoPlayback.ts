import { createSignal } from "solid-js";
import { MinHeap, timerManager } from 'opencord-utils';

interface BufferItem {
  timestamp: number;
  frame: EncodedVideoChunk;
  sequence: number;
}

const DEFAULT_DECODER_CONFIG: VideoDecoderConfig = {
  codec: 'vp8',
};

export class VideoPlayback {
  decoder: VideoDecoder;
  hasReceivedKeyFrame: boolean = false;
  delay: number;
  buffer: MinHeap<BufferItem>;
  writer: WritableStreamDefaultWriter;
  stream: MediaStream;
  bufferInterval: number | null;
  private frameCount: number = 0;
  private lastFpsTime: number = Date.now();

  private lastSequence: number = -1;
  private droppedFrames: number = 0;
  private receivedFrames: number = 0;

  private getFpsSignal: () => number;
  private setFpsSignal: (value: number) => number;
  private getDropRateSignal: () => number;
  private setDropRateSignal: (value: number) => number;


  constructor(
    delay: number = 0,
    decoderConfig: VideoDecoderConfig = DEFAULT_DECODER_CONFIG
  ) {
    const [getFps, setFps] = createSignal<number>(0);
    this.getFpsSignal = getFps;
    this.setFpsSignal = setFps;

    const [getDropRate, setDropRate] = createSignal<number>(0);
    this.getDropRateSignal = getDropRate;
    this.setDropRateSignal = setDropRate;

    this.delay = delay;
    this.decoder = new VideoDecoder({
      output: async (frame) => {
        try {
          await this.writer.write(frame);
        } catch {
          frame.close();
        }
      },
      error: (e) => console.error('Video decoder error:', e)
    });

    this.decoder.configure(decoderConfig);

    const generator = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = generator.writable.getWriter();
    this.stream = new MediaStream([generator]);
    this.buffer = new MinHeap<BufferItem>((a, b) => a.timestamp - b.timestamp);


    this.bufferInterval = timerManager.setInterval(() => {
      this.processBuffer();
    }, 10);
  }

  pushFrame(frame: EncodedVideoChunk, timestamp: number, sequence: number) {
    const presentationTime = timestamp + this.delay;
    this.buffer.insert({ timestamp: presentationTime, frame, sequence });
  }

  getDropRate() {
    return this.getDropRateSignal;
  }

  processBuffer() {
    const now = Date.now();

    while (this.buffer.size() != 0) {
      const nextItem = this.buffer.peek();
      if (!nextItem || nextItem.timestamp > now) break;

      const item = this.buffer.extractMin()!;

      this.receivedFrames++;
      if (this.lastSequence >= 0 && item.sequence > this.lastSequence + 1) {
        this.droppedFrames += item.sequence - this.lastSequence - 1;
      }
      this.lastSequence = item.sequence;
      this.updateDropRate();

      try {
        if (item.frame.type == "key") this.hasReceivedKeyFrame = true
        if (this.hasReceivedKeyFrame && this.decoder.state === 'configured') {
          this.decoder.decode(item.frame);
          this.frameCount++;
          this.updateFPS();
        }
      } catch (error) {
        console.error('Failed to decode video frame:', error);
      }
    }
  }

  private updateDropRate() {
    const total = this.receivedFrames + this.droppedFrames;
    const dropRate = total > 0 ? Math.round((this.droppedFrames / total) * 100) : 0;
    this.setDropRateSignal(dropRate);
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
    this.hasReceivedKeyFrame = false;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.lastSequence = -1;
    this.droppedFrames = 0;
    this.receivedFrames = 0;
    this.setFpsSignal(0);
    this.setDropRateSignal(0);
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
      timerManager.clearInterval(this.bufferInterval);
      this.bufferInterval = null;
    }

    this.clearBuffer();

    this.hasReceivedKeyFrame = false

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

