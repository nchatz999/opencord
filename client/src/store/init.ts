import { useVoip } from "./voip";
import { useConnection } from "./connection";
import { useApp } from "./app";
import { useAuth } from "./auth";
import { useUser } from "./user";
import { useServer } from "./server";
import { useRole } from "./role";
import { useGroup } from "./group";
import { useChannel } from "./channel";
import { useMessage } from "./message";
import { useFile } from "./file";
import { useReaction } from "./reaction";
import { useAcl } from "./acl";
import { useLiveKit } from "../lib/livekit";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";

const connection = useConnection();
const [, appActions] = useApp();
const [, authActions] = useAuth();
const [, voipActions] = useVoip();
const [, livekitActions] = useLiveKit();

connection.onConnectionLost(async () => {
    await livekitActions.disconnect();
    const voipSession = voipActions.findById(authActions.getUser().userId);
    appActions.setView({ type: "loading", channelId: voipSession?.channelId });
});

connection.onConnectionClosed(async () => {
    await livekitActions.disconnect();
    authActions.clearLocal();
    appActions.setView({ type: "unauthenticated" });
});

export { connection };

export async function resetStore() {
    await livekitActions.disconnect();
}

export async function initializeStores(): Promise<Result<void, string>> {
    const [, userActions] = useUser();
    const [, serverActions] = useServer();
    const [, roleActions] = useRole();
    const [, groupActions] = useGroup();
    const [, channelActions] = useChannel();
    const [, messageActions] = useMessage();
    const [, fileActions] = useFile();
    const [, reactionActions] = useReaction();
    const [, aclActions] = useAcl();

    const results = await Promise.all([
        userActions.init(),
        serverActions.init(),
        roleActions.init(),
        groupActions.init(),
        channelActions.init(),
        messageActions.init(),
        fileActions.init(),
        reactionActions.init(),
        aclActions.init(),
        voipActions.init(),
    ]);

    const failed = results.find((r) => r.isErr());
    if (failed?.isErr()) {
        return err(failed.error);
    }
    return ok(undefined);
}
