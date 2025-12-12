import { useConnection, type VoipPayload } from './store/connection'
import { usePlayback } from './store/playback'
import { useMicrophone } from './store/microphone'
import { useCamera } from './store/camera'
import { useScreenShare } from './store/screenShare'
import { useOutput } from './store/output'
import { getServerUrlOrDefault } from './contexts/ServerConfig'

export function getWebTransportUrl(): string {
  const serverUrl = getServerUrlOrDefault();
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}:4443/session`;
}

const connection = useConnection();
const [, playbackActions] = usePlayback();

connection.onVoipData((frame: VoipPayload) => {
  if (frame.type === "media") {
    switch (frame.mediaType) {
      case "voice": {
        const packet = new EncodedAudioChunk({
          type: frame.key,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        playbackActions.streamMedia(frame.userId, 'voice', packet, frame.timestamp)
        break
      }
      case "camera": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        playbackActions.streamMedia(frame.userId, 'camera', videoPacket, frame.timestamp)
        break
      }
      case "screen": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        playbackActions.streamMedia(frame.userId, 'screen', videoPacket, frame.timestamp)
        break
      }
      case "screenSound": {
        const audioPacket = new EncodedAudioChunk({
          type: frame.key as EncodedAudioChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        playbackActions.streamMedia(frame.userId, 'screenSound', audioPacket, frame.timestamp)
        break
      }
    }
  } else if (frame.type === "speech") {
    playbackActions.updateSpeakingState(frame.userId, frame.isSpeaking)
  }
});

connection.onConnectionError((reason) => {
  console.error("Connection error:", reason);
});

connection.onConnectionClosed(() => {
  console.log("Connection closed");
});

export { connection };

export async function resetStore() {
  const [, microphoneActions] = useMicrophone();
  const [, cameraActions] = useCamera();
  const [, screenShareActions] = useScreenShare();

  await microphoneActions.stop()
  await cameraActions.stop()
  await screenShareActions.stop()
}

export { useMicrophone, useCamera, useScreenShare, useOutput };
