import { type Component, onMount } from "solid-js";
import { useAuth, useConnection, initializeStores, getWebTransportUrl } from "../store/index";
import { useApp } from "../store/app";
import { useToaster } from "../components/Toaster";
import logo from "../assets/opencord.webp";

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LoadingPage: Component = () => {
  const [auth, authActions] = useAuth();
  const [, appActions] = useApp();
  const connectionActions = useConnection();
  const { addToast } = useToaster();

  onMount(() => {
    connectWithRetry();
  });

  const connectWithRetry = async () => {
    if (!auth.session) {
      appActions.setView("unauthenticated");
      return;
    }

    const url = getWebTransportUrl();
    let retries = 0;

    while (retries < MAX_RETRIES) {
      const connectResult = await connectionActions.connect(url, auth.session.sessionToken);

      if (connectResult.isErr()) {
        if (connectResult.error === "Connection rejected by server") {
          authActions.logout();
          appActions.setView("unauthenticated");
          return;
        }

        addToast(connectResult.error, "error");
        retries++;

        if (retries < MAX_RETRIES) {
          await sleep(1000 * retries);
          continue;
        }

        appActions.setView("error", "Max retries exceeded");
        return;
      }

      await sleep(100);
      await initializeStores();
      appActions.setView("app");
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
