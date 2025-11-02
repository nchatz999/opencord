
interface BufferItem {
  seq: number;
  timestamp: number;
  pst: number;
  frame: EncodedVideoChunk;
}


const DEFAULT_DECODER_CONFIG: VideoDecoderConfig = {
  codec: 'vp09.00.10.08',
  codedWidth: 1920,
  codedHeight: 1080,
};

export class VideoPlayback {
  decoder: VideoDecoder;
  hasReceivedKey: boolean = false;
  delay: number;
  buffer: BufferItem[];
  writer: WritableStreamDefaultWriter;
  stream: MediaStream;
  missedFrames: number;
  droppedFrames: number;
  startTimestamp: number | null;
  baseTimestamp: number | null;
  lastSeq: number;
  bufferInterval: number | null;


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
    this.droppedFrames = 0;
    this.missedFrames = 0;
    this.startTimestamp = null;
    this.baseTimestamp = null;
    this.lastSeq = -1;

    
    this.bufferInterval = setInterval(() => {
      this.processBuffer();
    }, 10);
  }

  pushFrame(frame: EncodedVideoChunk, seq: number) {
    if (!this.startTimestamp || !this.baseTimestamp) {
      this.startTimestamp = frame.timestamp;
      this.baseTimestamp = performance.now() + this.delay;
    }

    if (seq <= this.lastSeq) {
      this.droppedFrames++;
      return;
    }

    const presentationTime = this.baseTimestamp + (frame.timestamp - this.startTimestamp) / 1000;
    this.buffer.push({ seq, timestamp: frame.timestamp, pst: presentationTime, frame });
  }

  processBuffer() {
    if (this.decoder.state !== 'configured') return;

    const now = performance.now();
    this.buffer.sort((a, b) => a.timestamp - b.timestamp);

    while (this.buffer.length > 0 && this.buffer[0].pst <= now) {
      const item = this.buffer.shift();
      if (item) {
        try {
          let diff = item.seq - this.lastSeq;
          if (diff > 1) {
            this.missedFrames += (diff - 1);
          }
          if (item.frame.type == "key") this.hasReceivedKey = true
          if (this.hasReceivedKey) {
            this.decoder.decode(item.frame);
            this.lastSeq = item.seq;
          }
        } catch (error) {
          console.error('Failed to decode video frame:', error);
        }
      }
    }
  }

  resetTimestamps() {
    this.startTimestamp = null;
    this.baseTimestamp = null;
    this.hasReceivedKey = false
  }

  clearBuffer() {
    
    this.buffer = [];

    
    this.resetTimestamps();

    console.log('Video buffer cleared');
  }


  
  getStream(): MediaStream {
    return this.stream;
  }

  
  getStats() {
    return {
      missedFrames: this.missedFrames,
      droppedFrames: this.droppedFrames,
      bufferLength: this.buffer.length,
      decoderState: this.decoder.state,
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

