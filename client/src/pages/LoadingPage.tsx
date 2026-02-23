import { type Component, onMount, onCleanup } from "solid-js";
import { useAuth, useConnection, initializeStores, useVoip } from "../store/index";
import { useApp } from "../store/app";
import { useLiveKit } from "../lib/livekit";
import Button from "../components/Button";
import logo from "../assets/opencord.webp";

const RETRY_DELAY = 1000;
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

    let cancelled = false;

    onMount(() => connectWithRetry());
    onCleanup(() => { cancelled = true; });

    const handleCancel = () => {
        cancelled = true;
        connection.disconnect();
        authActions.clearLocal();
        appActions.setView({ type: "unauthenticated" });
    };

    const connectWithRetry = async () => {
        if (!auth.session) {
            appActions.setView({ type: "unauthenticated" });
            return;
        }

        while (true) {
            if (cancelled) return;

            const connectResult = await connection.connect(auth.session.sessionToken);
            if (cancelled) return;

            if (connectResult.isErr()) {
                if (connectResult.error.type === "authFailed") {
                    authActions.clearLocal();
                    appActions.setView({ type: "unauthenticated" });
                    return;
                }
                await sleep(RETRY_DELAY);
                continue;
            }

            connection.pauseEvents();
            const initResult = await initializeStores();
            if (cancelled) return;
            if (!connection.isConnected()) continue;

            if (initResult.isErr()) {
                await sleep(RETRY_DELAY);
                continue;
            }
            connection.resumeEvents();

            if (props.channelId) {
                await voipActions.joinChannel(props.channelId, livekitActions.getMuted(), livekitActions.getDeafened());
            }
            if (cancelled) {
                await livekitActions.disconnect();
                return;
            }
            if (!connection.isConnected()) continue;

            appActions.setView({ type: "app" });
            return;
        }
    };

    return (
        <div class="fixed inset-0 bg-bg-base flex items-center justify-center">
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
                <div class="text-fg-muted text-sm font-medium">Connecting...</div>
                <Button onClick={handleCancel} variant="primary" size="sm">
                    Sign in to a different account
                </Button>
            </div>
        </div>
    );
};

export default LoadingPage;
