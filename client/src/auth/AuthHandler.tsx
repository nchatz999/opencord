import type { Component } from "solid-js";
import { createEffect, Match, Switch } from "solid-js";
import { userDomain, connection, handleConnect } from "../store";
import { loadSession } from "../contexts/Session";
import Loading from "./Loading";
import Auth from "./Auth";
import App from "../App";
import { useToaster } from "../components/Toaster";
import { Button } from "../components/Button";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const AuthHandler: Component = () => {
  const { addToast } = useToaster()
  createEffect(async () => {
    const appState = userDomain.getAppState();

    if (appState.type === 'loading') {

      const maybeToken = loadSession();

      if (!maybeToken.ok) {

        userDomain.setAppState({ type: 'unauthenticated' });
        return;
      }


      userDomain.setAppState({ type: 'connecting' });
      userDomain.setCurrentUser(maybeToken.value.userId);
      connection.setToken(maybeToken.value.sessionToken);

      let connectResult;
      do {
        connectResult = await connection.connect();
        if (!connectResult.ok) {
          addToast(connectResult.error.message.toString(), "error");
          await sleep(1000);
        }
      } while (!connectResult.ok);

      await handleConnect()
      userDomain.setAppState({ type: 'authenticated' });

    }
  });

  const ConnectionError = () => (
    <div class="min-h-screen bg-[#313338] flex items-center justify-center">
      <div class="bg-[#2b2d31] rounded-lg p-8 max-w-md w-full mx-4">
        <div class="text-center">
          <div class="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-white mb-4">Connection Lost</h2>
          <p class="text-[#b5bac1] mb-6 leading-relaxed">
            Your session may have expired, the server might be down, or you may have logged in from another device.
          </p>
          <div class="space-y-3">
            <Button
              variant="primary"
              class="w-full"
              onClick={() => userDomain.setAppState({ type: 'loading' })}
            >
              Retry Connection
            </Button>
            <Button
              variant="secondary"
              class="w-full"
              onClick={() => userDomain.setAppState({ type: 'unauthenticated' })}
            >
              Sign In Again
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Switch>
      <Match when={userDomain.getAppState().type === 'loading'}>
        <Loading />
      </Match>
      <Match when={userDomain.getAppState().type === 'connecting'}>
        <Loading />
      </Match>
      <Match when={userDomain.getAppState().type === 'unauthenticated'}>
        <Auth />
      </Match>
      <Match when={userDomain.getAppState().type === 'connectionError'}>
        <ConnectionError />
      </Match>
      <Match when={userDomain.getAppState().type === 'authenticated'}>
        <App />
      </Match>
    </Switch>
  );
};

export default AuthHandler;
