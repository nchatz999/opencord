import type { Component } from "solid-js";
import { createEffect, Match, Switch } from "solid-js";
import { userDomain, connection, getInitialData, getWebTransportUrl } from "../store";
import { loadSession } from "../contexts/Session";
import { getServerUrl } from "../contexts/ServerConfig";
import Loading from "./Loading";
import Auth from "./Auth";
import App from "../App";
import { useToaster } from "../components/Toaster";
import ConnectionError from "./ConnectionError";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const AuthHandler: Component = () => {
  const { addToast } = useToaster()
  createEffect(async () => {
    const appState = userDomain.getAppState();

    if (appState.type === 'loading') {
      const serverUrl = getServerUrl();
      if (!serverUrl) {
        userDomain.setAppState({ type: 'unauthenticated' });
        return;
      }

      const maybeToken = loadSession();
      if (maybeToken.isErr()) {
        userDomain.setAppState({ type: 'unauthenticated' });
        return;
      }

      userDomain.setAppState({ type: 'connecting' });
      userDomain.setCurrentUser(maybeToken.value.userId);

      const url = getWebTransportUrl();
      const MAX_RETRIES = 5;
      let retries = 0;

      while (retries < MAX_RETRIES) {
        const connectResult = await connection.connect(url, maybeToken.value.sessionToken);

        if (connectResult.isErr()) {
          addToast(connectResult.error, "error");

          if (connectResult.error === 'Connection rejected by server') {
            userDomain.setAppState({ type: 'unauthenticated' });
            return;
          }

          retries++;
          if (retries < MAX_RETRIES) {
            await sleep(1000 * retries);
            continue;
          }

          userDomain.setAppState({ type: 'connectionError', reason: 'Max retries exceeded' });
          return;
        }

        await sleep(100);
        await getInitialData();
        userDomain.setAppState({ type: 'authenticated' });
        return;
      }
    }
  });


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
