import {
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
import { useServer } from "./server";
import { useMicrophone } from "./microphone";
import { useCamera } from "./camera";
import { useScreenShare } from "./screenShare";

export async function initializeStores() {
  const [, userActions] = useUser();
  const [, serverActions] = useServer();
  const [, roleActions] = useRole();
  const [, groupActions] = useGroup();
  const [, channelActions] = useChannel();
  const [, messageActions] = useMessage();
  const [, fileActions] = useFile();
  const [, aclActions] = useAcl();
  const [, subscriptionActions] = useSubscription();
  const [, voipActions] = useVoip();
  const [, microphoneActions] = useMicrophone();
  const [, cameraActions] = useCamera();
  const [, screenShareActions] = useScreenShare();

  // Initialize media device stores (synchronous)
  microphoneActions.init();
  cameraActions.init();
  screenShareActions.init();

  // Initialize data stores (async)
  await Promise.all([
    userActions.init(),
    serverActions.init(),
    roleActions.init(),
    groupActions.init(),
    channelActions.init(),
    messageActions.init(),
    fileActions.init(),
    aclActions.init(),
    subscriptionActions.init(),
    voipActions.init(),
  ]);
}
