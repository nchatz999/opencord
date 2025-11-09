import { createSignal } from "solid-js";

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
  buffer: BufferItem[];
  writer: WritableStreamDefaultWriter;
  stream: MediaStream;
  bufferInterval: number | null;
  private frameCount: number = 0;
  private lastFpsTime: number = Date.now();
  private [fps, setFps] = createSignal(0);


  constructor(
    delay: number = 0,
    decoderConfig: VideoDecoderConfig = DEFAULT_DECODER_CONFIG
  ) {
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

    this.buffer = [];


    this.bufferInterval = setInterval(() => {
      this.processBuffer();
    }, 10);
  }

  pushFrame(frame: EncodedVideoChunk, timestamp: number) {

    const presentationTime = timestamp + this.delay
    this.buffer.push({ timestamp: presentationTime, frame });
  }

  processBuffer() {
    if (this.decoder.state !== 'configured') return;

    const now = Date.now();
    this.buffer.sort((a, b) => a.timestamp - b.timestamp);

    while (this.buffer.length > 0 && this.buffer[0].timestamp <= now) {
      const item = this.buffer.shift();
      if (item) {
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
  }

  resetTimestamps() {
    this.hasReceivedKey = false;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.setFps(0);
  }

  clearBuffer() {
    this.buffer = [];
    this.resetTimestamps();

  }

  getStream(): MediaStream {
    return this.stream;
  }

  getFPS() {
    return this.fps;
  }

  getStats() {
    return {
      bufferLength: this.buffer.length,
      decoderState: this.decoder.state,
      fps: this.fps(),
    };
  }

  cleanup() {

    if (this.bufferInterval !== null) {
      clearInterval(this.bufferInterval);
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

