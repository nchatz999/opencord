import { type Component, onMount } from "solid-js";
import { useAuth, useConnection, initializeStores, useVoip } from "../store/index";
import { useApp } from "../store/app";
import { useLiveKit } from "../lib/livekit";
import logo from "../assets/opencord.webp";

const MAX_RETRIES = 5;
const RETRY_DELAY = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface LoadingPageProps {
    channelId?: number;
}

const LoadingPage: Component<LoadingPageProps> = (props) => {
    const [auth, authActions] = useAuth();
    const [, appActions] = useApp();
    const [, voipActions] = useVoip();
    const [, livekitActions] = useLiveKit();
    const connection = useConnection();

    onMount(() => {
        connectWithRetry();
    });

    const connectWithRetry = async () => {
        if (!auth.session) {
            appActions.setView({ type: "unauthenticated" });
            return;
        }

        let retries = 0;
        while (retries < MAX_RETRIES) {
            const result = await connection.connect(auth.session.sessionToken);

            if (result.isErr()) {
                if (result.error.type === "authFailed") {
                    await authActions.logout();
                    appActions.setView({ type: "unauthenticated" });
                    return;
                }

                retries++;
                if (retries < MAX_RETRIES) {
                    await sleep(RETRY_DELAY);
                    continue;
                }

                appActions.setView({ type: "error", error: "Connection failed" });
                return;
            }

            await initializeStores();
            if (props.channelId) {
                await voipActions.joinChannel(props.channelId, livekitActions.getMuted(), livekitActions.getDeafened());
            }
            appActions.setView({ type: "app" });
            return;
        }
    };

    return (
        <div class="fixed inset-0 bg-background flex items-center justify-center">
            <div class="flex flex-col items-center gap-4">
                <img
                    src={logo}
                    alt="Loading..."
                    class="w-16 h-16 animate-spin"
                    style={{
                        "animation-duration": "2s",
                        "animation-timing-function": "linear",
                        "animation-iteration-count": "infinite",
                    }}
                />
                <div class="text-secondary-text text-sm font-medium">Connecting...</div>
            </div>
        </div>
    );
};

export default LoadingPage;
