import { createSignal } from 'solid-js';

export interface CameraConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  facingMode?: 'user' | 'environment';
  aspectRatio?: number;
}

export interface VideoEncoderConfig {
  codec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  framerate?: number;
  keyFrameIntervalCount?: number;
}

export class Camera {
  private stream: MediaStream | null = null;
  private processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  private encoder: VideoEncoder | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private isProcessing = false;

  private getIsRecordingSignal: () => boolean;
  private setIsRecordingSignal: (value: boolean) => boolean;
  private getQualitySignal: () => number;
  private setQualitySignal: (value: number) => number;

  private constraints: CameraConstraints = {
    width: 1280,
    height: 720,
    frameRate: 30,
    facingMode: 'user',
    aspectRatio: 16 / 9,
  };

  private encoderConfig: VideoEncoderConfig = {
    codec: 'vp8',
    width: 1280,
    height: 720,
    bitrate: 1500000,
    framerate: 30,
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
    
    if (this.encoder && this.encoder.state === 'configured') {
      const newBitrate = Math.floor(this.encoderConfig.bitrate! * clampedQuality);
      this.encoder.configure({
        ...this.encoderConfig,
        bitrate: newBitrate
      } as VideoEncoderConfig);
    }
  }

  getQuality(): number {
    return this.getQualitySignal();
  }


  isRecording(): boolean {
    return this.getIsRecordingSignal();
  }

  setConstraints(constraints: Partial<CameraConstraints>): void {
    this.constraints = { ...this.constraints, ...constraints };
  }

  getConstraints(): CameraConstraints {
    return { ...this.constraints };
  }

  getStream(): MediaStream | null {
    return this.stream;
  }


  onEncodedData(callback: (chunk: EncodedVideoChunk) => void) {
    this.encodedDataCallback = callback;
  }

  async start(): Promise<void> {
    if (this.getIsRecordingSignal()) {
      console.warn('Camera already recording');
      return;
    }

    try {

      const mediaConstraints: MediaStreamConstraints = {
        video: {
          width: { ideal: this.constraints.width },
          height: { ideal: this.constraints.height },
          frameRate: { ideal: this.constraints.frameRate },
          facingMode: this.constraints.facingMode,
          aspectRatio: this.constraints.aspectRatio,
        },
        audio: false,
      };

      this.stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);


      const videoTrack = this.stream.getVideoTracks()[0];


      videoTrack.onended = () => {
        console.log('Camera track ended');
        this.stop();
      };

      this.processor = new MediaStreamTrackProcessor({ track: videoTrack });


      this.setupEncoder();


      this.isProcessing = true;
      this.processVideoStream();

      this.setIsRecordingSignal(true);
    } catch (error) {
      console.error('Error starting camera:', error);
      await this.cleanup();
      throw error;
    }
  }

  private setupEncoder(): void {
    const quality = this.getQualitySignal();
    const config: VideoEncoderConfig = {
      ...this.encoderConfig,
      width: Math.floor(this.encoderConfig.width! * quality),
      height: Math.floor(this.encoderConfig.height! * quality),
      bitrate: Math.floor(this.encoderConfig.bitrate! * quality),
    };

    this.encoder = new VideoEncoder({
      output: (chunk, _metadata) => {
        this.encodedDataCallback(chunk);
      },
      error: (error) => {
        console.error('Camera encoder error:', error);
      },
    });

    this.encoder.configure(config);
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
        console.error('Error processing camera stream:', error);
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
    this.encodedDataCallbacks = [];
  }
}
