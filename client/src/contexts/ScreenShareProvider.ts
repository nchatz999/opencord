import { createSignal } from 'solid-js';

export interface ScreenShareConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  cursor?: 'always' | 'motion' | 'never';
  displaySurface?: 'application' | 'browser' | 'monitor' | 'window';
}

export interface VideoEncoderConfig {
  codec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
  keyFrameIntervalCount?: number;
}

export class ScreenShare {
  private stream: MediaStream | null = null;
  private processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  private encoder: VideoEncoder | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private isProcessing = false;

  private getIsRecordingSignal: () => boolean;
  private setIsRecordingSignal: (value: boolean) => boolean;
  private getQualitySignal: () => number;
  private setQualitySignal: (value: number) => number;

  private constraints: ScreenShareConstraints = {
    width: 1920,
    height: 1080,
    frameRate: 30,
    cursor: 'always',
  };

  private encoderConfig: VideoEncoderConfig = {
    codec: 'vp8',
    width: 1920,
    height: 1080,
    bitrate: 2500000,
    framerate: 30,
    keyFrameIntervalCount: 30,
  };

  private encodedDataCallback: (chunk: EncodedVideoChunk) => void = () => { };

  constructor(encoderConfig?: VideoEncoderConfig) {
    if (encoderConfig) {
      this.encoderConfig = { ...this.encoderConfig, ...encoderConfig };
    }


    const [getIsRecording, setIsRecording] = createSignal<boolean>(false);
    this.getIsRecordingSignal = getIsRecording;
    this.setIsRecordingSignal = setIsRecording;


    const [getQuality, setQuality] = createSignal<number>(1.0);
    this.getQualitySignal = getQuality;
    this.setQualitySignal = setQuality;
  }

  setQuality(quality: number): void {
    const clampedQuality = Math.max(0.1, Math.min(1.0, quality));
    this.setQualitySignal(clampedQuality);


    if (this.encoder && this.encoder.state === 'configured') {
      const newBitrate = Math.floor(this.encoderConfig.bitrate! * clampedQuality);

      console.log(`Quality changed to ${clampedQuality}, bitrate: ${newBitrate}`);
    }
  }

  getQuality(): number {
    return this.getQualitySignal();
  }

  isRecording(): boolean {
    return this.getIsRecordingSignal();
  }

  setConstraints(constraints: Partial<ScreenShareConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  getConstraints(): ScreenShareConstraints {
    return { ...this.constraints };
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  onEncodedVideoData(callback: (chunk: EncodedVideoChunk) => void) {
    this.encodedDataCallback = callback
  }

  async start(): Promise<void> {
    if (this.getIsRecordingSignal()) {
      console.warn('Already screen sharing');
      return;
    }

    try {

      const mediaConstraints: DisplayMediaStreamConstraints = {
        video: {
          width: this.constraints.width,
          height: this.constraints.height,
          frameRate: this.constraints.frameRate,
          cursor: this.constraints.cursor,
          displaySurface: this.constraints.displaySurface,
        } as MediaTrackConstraints,
        audio: false,
      };

      this.stream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);


      const videoTrack = this.stream.getVideoTracks()[0];


      videoTrack.onended = () => {
        console.log('Screen share ended by user');
        this.stop();
      };

      this.processor = new MediaStreamTrackProcessor({ track: videoTrack });


      this.setupEncoder();


      this.isProcessing = true;
      this.processVideoStream();

      this.setIsRecordingSignal(true);
    } catch (error) {
      console.error('Error starting screen share:', error);
      await this.cleanup();
      throw error;
    }
  }

  private setupEncoder(): void {
    const config = {
      ...this.encoderConfig,
      bitrate: Math.floor(this.encoderConfig.bitrate! * this.getQualitySignal()),
    };

    this.encoder = new VideoEncoder({
      output: (chunk, _metadata) => {
        this.encodedDataCallback(chunk);
      },
      error: (error) => {
        console.error('Video encoder error:', error);
      },
    });

    this.encoder.configure(config as VideoEncoderConfig);
  }

  private async processVideoStream(): Promise<void> {
    if (!this.processor) return;

    this.reader = this.processor.readable.getReader();

    try {
      while (this.isProcessing) {
        const { done, value } = await this.reader.read();

        if (done) break;

        if (value) {

          if (this.encoder && this.encoder.state === 'configured') {
            const keyFrame = Math.random() < 0.03;
            this.encoder.encode(value, { keyFrame });
          }


          value.close();
        }
      }
    } catch (error) {
      if (this.isProcessing) {
        console.error('Error processing video stream:', error);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.getIsRecordingSignal()) {
      return;
    }

    this.isProcessing = false;


    if (this.encoder && this.encoder.state === 'configured') {
      await this.encoder.flush();
    }

    await this.cleanup();
    this.setIsRecordingSignal(false);
  }

  private async cleanup(): Promise<void> {

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (e) {

      }
      this.reader = null;
    }


    if (this.encoder) {
      if (this.encoder.state !== 'closed') {
        this.encoder.close();
      }
      this.encoder = null;
    }


    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.processor = null;
  }

  async destroy(): Promise<void> {
    await this.stop();
  }
}
