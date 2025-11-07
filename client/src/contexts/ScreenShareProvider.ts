import { createSignal } from 'solid-js';
import { fetchApi } from '../utils';

// Define types for Audio Encoding
export interface AudioEncoderConfig {
  codec?: string;
  sampleRate?: number;
  numberOfChannels?: number;
  bitrate?: number;
}

// Existing constraints interface
export interface ScreenShareConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
  cursor?: 'always' | 'motion' | 'never';
  displaySurface?: 'application' | 'browser' | 'monitor' | 'window';
  // Add property to request audio
  audio?: boolean;
}

// Existing video encoder config
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

  private videoProcessor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  private videoEncoder: VideoEncoder | null = null;
  private videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;

  private audioProcessor: MediaStreamTrackProcessor<AudioData> | null = null;
  private audioEncoder: AudioEncoder | null = null;
  private audioReader: ReadableStreamDefaultReader<AudioData> | null = null;

  private isProcessing = false;

  private getIsRecordingSignal: () => boolean;
  private setIsRecordingSignal: (value: boolean) => boolean;
  private getQualitySignal: () => number;
  private setQualitySignal: (value: number) => number;

  private constraints: ScreenShareConstraints = {
    width: 1920,
    height: 1080,
    frameRate: 60,
    cursor: 'always',
    audio: true, // Default to true to include audio
  };

  private videoEncoderConfig: VideoEncoderConfig = {
    codec: 'vp8',
    width: 1920,
    height: 1080,
    bitrate: 2500000,
    framerate: 60,
    keyFrameIntervalCount: 30,
  };

  private audioEncoderConfig: AudioEncoderConfig = {
    codec: 'opus',
    sampleRate: 48000,
    numberOfChannels: 1,
    bitrate: 128000,
  };

  private encodedVideoDataCallback: (chunk: EncodedVideoChunk) => void = () => { };
  private encodedAudioDataCallback: (chunk: EncodedAudioChunk) => void = () => { };

  constructor(videoEncoderConfig?: VideoEncoderConfig, audioEncoderConfig?: AudioEncoderConfig) {
    if (videoEncoderConfig) {
      this.videoEncoderConfig = { ...this.videoEncoderConfig, ...videoEncoderConfig };
    }
    if (audioEncoderConfig) {
      this.audioEncoderConfig = { ...this.audioEncoderConfig, ...audioEncoderConfig };
    }

    const [getIsRecording, setIsRecording] = createSignal<boolean>(false);
    this.getIsRecordingSignal = getIsRecording;
    this.setIsRecordingSignal = setIsRecording;

    const [getQuality, setQuality] = createSignal<number>(1.0);
    this.getQualitySignal = getQuality;
    this.setQualitySignal = setQuality;
  }

  setQuality(quality: number): void {

    this.setQualitySignal(quality);
    if (this.videoEncoder && this.videoEncoder.state === 'configured') {
      this.videoEncoder.configure({
        ...this.videoEncoderConfig,
        bitrate: quality
      });
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
    this.encodedVideoDataCallback = callback;
  }

  onEncodedAudioData(callback: (chunk: EncodedAudioChunk) => void) {
    this.encodedAudioDataCallback = callback;
  }

  async start(): Promise<void> {
    if (this.getIsRecordingSignal()) {
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
        audio: this.constraints.audio,
      };

      this.stream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);

      this.stream.getVideoTracks()[0].onended = async () => {
        await fetchApi('/voip/screen/publish', {
          method: 'PUT',
          body: { publish: false }
        })

        this.stop();
      };

      const videoTrack = this.stream.getVideoTracks()[0];
      this.videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
      this.setupVideoEncoder();

      const audioTrack = this.stream.getAudioTracks()[0];
      if (audioTrack) {
        this.audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });
        this.setupAudioEncoder();
      } else if (this.constraints.audio) {
        console.warn('Requested audio but no audio track was provided by getDisplayMedia.');
      }

      this.isProcessing = true;
      this.setIsRecordingSignal(true);
      this.processVideoStream();
      this.processAudioStream();

    } catch (error) {
      console.error('Error starting screen share:', error);
      await this.cleanup();
      throw error;
    }
  }


  private setupVideoEncoder(): void {
    const config = {
      ...this.videoEncoderConfig,
      bitrate: Math.floor(this.videoEncoderConfig.bitrate! * this.getQualitySignal()),
    };

    this.videoEncoder = new VideoEncoder({
      output: (chunk, _metadata) => {
        this.encodedVideoDataCallback(chunk);
      },
      error: (error) => {
        console.error('Video encoder error:', error);
      },
    });

    this.videoEncoder.configure(config as VideoEncoderConfig);
  }

  private async processVideoStream(): Promise<void> {
    if (!this.videoProcessor) return;

    this.videoReader = this.videoProcessor.readable.getReader();

    try {
      while (this.isProcessing) {
        const { done, value } = await this.videoReader.read();

        if (done) break;
        if (value) {
          if (this.videoEncoder && this.videoEncoder.state === 'configured') {
            const keyFrame = Math.random() < 0.03;
            this.videoEncoder.encode(value, { keyFrame });
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


  private setupAudioEncoder(): void {
    this.audioEncoder = new AudioEncoder({
      output: (chunk, _metadata) => {
        this.encodedAudioDataCallback(chunk);
      },
      error: (error) => {
        console.error('Audio encoder error:', error);
      },
    });

    const config: AudioEncoderConfig = {
      codec: this.audioEncoderConfig.codec!,
      sampleRate: this.audioEncoderConfig.sampleRate!,
      numberOfChannels: this.audioEncoderConfig.numberOfChannels!,
      bitrate: this.audioEncoderConfig.bitrate!,
    };

    this.audioEncoder.configure(config);
  }

  private async processAudioStream(): Promise<void> {
    if (!this.audioProcessor) return;

    this.audioReader = this.audioProcessor.readable.getReader();

    try {
      while (this.isProcessing) {
        const { done, value } = await this.audioReader.read();

        if (done) break;

        if (value) {
          if (this.audioEncoder && this.audioEncoder.state === 'configured') {
            this.audioEncoder.encode(value);
          }
          value.close();
        }
      }
    } catch (error) {
      if (this.isProcessing) {
        console.error('Error processing audio stream:', error);
      }
    }
  }


  async stop(): Promise<void> {
    if (!this.getIsRecordingSignal()) {
      return;
    }

    this.isProcessing = false;

    if (this.videoEncoder && this.videoEncoder.state === 'configured') {
      await this.videoEncoder.flush();
    }
    if (this.audioEncoder && this.audioEncoder.state === 'configured') {
      await this.audioEncoder.flush();
    }

    await this.cleanup();
    this.setIsRecordingSignal(false);
  }

  private async cleanup(): Promise<void> {
    if (this.audioReader) {
      try { await this.audioReader.cancel(); } catch (e) { /* ignore */ }
      this.audioReader = null;
    }
    this.audioProcessor = null;

    if (this.videoReader) {
      try { await this.videoReader.cancel(); } catch (e) { /* ignore */ }
      this.videoReader = null;
    }
    this.videoProcessor = null;

    if (this.audioEncoder && this.audioEncoder.state !== 'closed') {
      this.audioEncoder.close();
      this.audioEncoder = null;
    }
    if (this.videoEncoder && this.videoEncoder.state !== 'closed') {
      this.videoEncoder.close();
      this.videoEncoder = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }
}
