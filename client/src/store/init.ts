import { useUser } from "./user";
import { useServer } from "./server";
import { useRole } from "./role";
import { useGroup } from "./group";
import { useChannel } from "./channel";
import { useMessage } from "./message";
import { useAcl } from "./acl";
import { useSubscription } from "./subscription";
import { useVoip } from "./voip";
import { useMicrophone } from "./microphone";
import { useCamera } from "./camera";
import { useScreenShare } from "./screenShare";
import { useConnection, type VoipPayload } from "./connection";
import { usePlayback } from "./playback";
import { useApp } from "./app";
import { getServerUrlOrDefault } from "../lib/ServerConfig";

export function getWebTransportUrl(): string {
  const serverUrl = getServerUrlOrDefault();
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}:4443/session`;
}

const connection = useConnection();
const [, playbackActions] = usePlayback();
const [, appActions] = useApp();

connection.onVoipData((frame: VoipPayload) => {
  if (frame.type === "media") {
    switch (frame.mediaType) {
      case "voice": {
        const packet = new EncodedAudioChunk({
          type: frame.key,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "voice", packet, frame.timestamp);
        break;
      }
      case "camera": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "camera", videoPacket, frame.timestamp);
        break;
      }
      case "screen": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "screen", videoPacket, frame.timestamp);
        break;
      }
      case "screenSound": {
        const audioPacket = new EncodedAudioChunk({
          type: frame.key as EncodedAudioChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "screenSound", audioPacket, frame.timestamp);
        break;
      }
    }
  } else if (frame.type === "speech") {
    playbackActions.updateSpeakingState(frame.userId, frame.isSpeaking);
  }
});

connection.onConnectionError((reason) => {
  appActions.setView("error", reason);
});

export { connection };

export async function resetStore() {
  const [, microphoneActions] = useMicrophone();
  const [, cameraActions] = useCamera();
  const [, screenShareActions] = useScreenShare();

  await microphoneActions.stop();
  await cameraActions.stop();
  await screenShareActions.stop();
}

export async function initializeStores() {
  const [, userActions] = useUser();
  const [, serverActions] = useServer();
  const [, roleActions] = useRole();
  const [, groupActions] = useGroup();
  const [, channelActions] = useChannel();
  const [, messageActions] = useMessage();
  const [, aclActions] = useAcl();
  const [, subscriptionActions] = useSubscription();
  const [, voipActions] = useVoip();
  const [, microphoneActions] = useMicrophone();
  const [, cameraActions] = useCamera();
  const [, screenShareActions] = useScreenShare();

  microphoneActions.init();
  cameraActions.init();
  screenShareActions.init();

  await Promise.all([
    userActions.init(),
    serverActions.init(),
    roleActions.init(),
    groupActions.init(),
    channelActions.init(),
    messageActions.init(),
    aclActions.init(),
    subscriptionActions.init(),
    voipActions.init(),
  ]);
}
