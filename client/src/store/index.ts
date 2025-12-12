// Entity stores (using factory pattern)
export {
  useUser,
  useRole,
  useGroup,
  useChannel,
  useMessage,
  useFile,
  useVoip,
  useAcl,
  useSubscription,
} from "./entities";
export type {
  UserStore,
  RoleStore,
  GroupStore,
  ChannelStore,
  MessageStore,
  FileStore,
  VoipStore,
  AclStore,
  SubscriptionStore,
} from "./entities";

// Factory utilities
export { api, createEntityStore } from "./factory";
export type { BaseActions, ApiHelpers } from "./factory";

// Dependency graph
export { dependencyGraph } from "./dependencies";
export type { EntityDependency } from "./dependencies";

// Non-entity stores (keep separate)
export { useServer } from "./server";
export type { ServerStore } from "./server";

export { useContext } from "./context";
export type { ContextStore } from "./context";

export { usePlayback, type PlaybackState } from "./playback";
export type { PlaybackStore } from "./playback";

export { useModal } from "./modal";
export type { ModalStore } from "./modal";

export { useConnection } from "./connection";
export type { ConnectionStore } from "./connection";

export { useAuth } from "./auth";
export type { AuthStore, AuthState, AuthActions } from "./auth";

// Media stores
export { useMicrophone } from "./microphone";
export type { MicrophoneStore } from "./microphone";

export { useCamera } from "./camera";
export type { CameraStore } from "./camera";

export { useScreenShare } from "./screenShare";
export type { ScreenShareStore } from "./screenShare";

export { useOutput } from "./output";
export type { OutputStore, AudioOutputDevice } from "./output";

// Initialization
export { initializeStores } from "./init";
