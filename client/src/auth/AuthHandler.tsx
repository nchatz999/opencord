import type { Component } from "solid-js";
import { createEffect, Match, Switch } from "solid-js";
import { userDomain, connection, getInitialData } from "../store";
import { loadSession } from "../contexts/Session";
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
      const maybeToken = loadSession();
      if (!maybeToken.ok) {
        userDomain.setAppState({ type: 'unauthenticated' });
        return;
      }

      userDomain.setAppState({ type: 'connecting' });
      userDomain.setCurrentUser(maybeToken.value.userId);

      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        const connectResult = await connection.connect(maybeToken.value.sessionToken);

        if (connectResult.ok) {
          await sleep(100);
          await getInitialData();
          userDomain.setAppState({ type: 'authenticated' });
          return;
        }

        addToast(connectResult.error, "error");

        if (connectResult.error === 'Connection rejected by server') {
          userDomain.setAppState({ type: 'unauthenticated' });
          return;
        }

        retries++;
        if (retries < maxRetries) {
          userDomain.setAppState({ type: 'connectionError', reason: `${connectResult.error} (retry ${retries}/${maxRetries})` });
          await sleep(5000);
        } else {
          userDomain.setAppState({ type: 'connectionError', reason: connectResult.error });
        }
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
