import { useUser } from "./user";
import { useServer } from "./server";
import { useRole } from "./role";
import { useGroup } from "./group";
import { useChannel } from "./channel";
import { useMessage } from "./message";
import { useFile } from "./file";
import { useReaction } from "./reaction";
import { useAcl } from "./acl";
import { useSubscription } from "./subscription";
import { useVoip } from "./voip";
import { useMicrophone } from "./microphone";
import { useCamera } from "./camera";
import { useScreenShare } from "./screenShare";
import { useConnection, type VoipPayload } from "./connection";
import { usePlayback } from "./playback";
import { useApp } from "./app";
import { useAuth } from "./auth";
import { getServerUrlOrDefault } from "../lib/ServerConfig";

function encodeChunkToUint8Array(chunk: EncodedAudioChunk | EncodedVideoChunk): Uint8Array {
  const buffer = new ArrayBuffer(chunk.byteLength);
  chunk.copyTo(buffer);
  return new Uint8Array(buffer);
}

export function getWebTransportUrl(): string {
  const serverUrl = getServerUrlOrDefault();
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}:4443/session`;
}

const connection = useConnection();
const [, playbackActions] = usePlayback();
const [, appActions] = useApp();
const [, authActions] = useAuth();
const [, voipActions] = useVoip();
const [, microphoneActions] = useMicrophone();
const [, cameraActions] = useCamera();
const [, screenShareActions] = useScreenShare();

microphoneActions.onEncodedData(async (chunk, sequence) => {
  const user = authActions.getUser();
  if (!user) return;
  const session = voipActions.findById(user.userId);
  if (!session) return;

  const payload: VoipPayload = {
    type: "media",
    userId: user.userId,
    mediaType: "voice",
    data: encodeChunkToUint8Array(chunk),
    timestamp: Date.now(),
    realTimestamp: Math.trunc(chunk.timestamp),
    key: chunk.type,
    sequence,
  };
  await connection.sendVoip(payload);
});

microphoneActions.onSpeech(async (isSpeaking) => {
  const user = authActions.getUser();
  if (!user) return;

  const payload: VoipPayload = {
    type: "speech",
    userId: user.userId,
    isSpeaking,
  };
  await connection.sendVoip(payload);
});

cameraActions.onEncodedData(async (chunk, sequence) => {
  const user = authActions.getUser();
  if (!user) return;
  const session = voipActions.findById(user.userId);
  if (!session) return;

  const payload: VoipPayload = {
    type: "media",
    userId: user.userId,
    mediaType: "camera",
    data: encodeChunkToUint8Array(chunk),
    timestamp: Date.now(),
    realTimestamp: Math.trunc(chunk.timestamp),
    key: chunk.type,
    sequence,
  };
  await connection.sendVoip(payload);
});

cameraActions.onRecordingStopped(async () => {
  await voipActions.publishCamera(false);
});

screenShareActions.onEncodedVideoData(async (chunk, sequence) => {
  const user = authActions.getUser();
  if (!user) return;
  const session = voipActions.findById(user.userId);
  if (!session) return;

  const payload: VoipPayload = {
    type: "media",
    userId: user.userId,
    mediaType: "screen",
    data: encodeChunkToUint8Array(chunk),
    timestamp: Date.now(),
    realTimestamp: Math.trunc(chunk.timestamp),
    key: chunk.type,
    sequence,
  };
  await connection.sendVoip(payload);
});

screenShareActions.onEncodedAudioData(async (chunk, sequence) => {
  const user = authActions.getUser();
  if (!user) return;
  const session = voipActions.findById(user.userId);
  if (!session) return;

  const payload: VoipPayload = {
    type: "media",
    userId: user.userId,
    mediaType: "screenSound",
    data: encodeChunkToUint8Array(chunk),
    timestamp: Date.now(),
    realTimestamp: Math.trunc(chunk.timestamp),
    key: chunk.type,
    sequence,
  };
  await connection.sendVoip(payload);
});

screenShareActions.onRecordingStopped(async () => {
  await voipActions.publishScreen(false);
});

connection.onVoipData((frame: VoipPayload) => {
  if (frame.type === "media") {
    const participant = voipActions.findById(frame.userId);
    const callType = participant?.recipientId ? "private" : "channel";

    switch (frame.mediaType) {
      case "voice": {
        const packet = new EncodedAudioChunk({
          type: frame.key,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "voice", packet, frame.timestamp, frame.sequence, callType);
        break;
      }
      case "camera": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "camera", videoPacket, frame.timestamp, frame.sequence, callType);
        break;
      }
      case "screen": {
        const videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "screen", videoPacket, frame.timestamp, frame.sequence, callType);
        break;
      }
      case "screenSound": {
        const audioPacket = new EncodedAudioChunk({
          type: frame.key as EncodedAudioChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data),
        });
        playbackActions.streamMedia(frame.userId, "screenSound", audioPacket, frame.timestamp, frame.sequence, callType);
        break;
      }
    }
  } else if (frame.type === "speech") {
    playbackActions.updateSpeakingState(frame.userId, frame.isSpeaking);
  }
});

connection.onServerError((reason) => {
  appActions.setView({ type: "error", error: reason });
});

connection.onConnectionLost(() => {
  const voipSession = voipActions.findById(authActions.getUser().userId);
  appActions.setView({ type: "loading", channelId: voipSession?.channelId });
});

connection.onConnectionClosed(async () => {
  await authActions.logout()
  appActions.setView({ type: "unauthenticated" });
});

export { connection };

export async function resetStore() {
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
  const [, fileActions] = useFile();
  const [, reactionActions] = useReaction();
  const [, aclActions] = useAcl();
  const [, subscriptionActions] = useSubscription();

  await Promise.all([
    userActions.init(),
    serverActions.init(),
    roleActions.init(),
    groupActions.init(),
    channelActions.init(),
    messageActions.init(),
    fileActions.init(),
    reactionActions.init(),
    aclActions.init(),
    subscriptionActions.init(),
    voipActions.init(),
  ]);
}
