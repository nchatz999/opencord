import type { Component } from "solid-js";
import { createEffect, Match, Switch } from "solid-js";
import { userDomain, connection, handleConnect } from "../store";
import { loadSession } from "../contexts/Session";
import Loading from "./Loading";
import Auth from "./Auth";
import App from "../App";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const AuthHandler: Component = () => {
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

      while (true) {
        connectResult = await connection.connect();

        if (connectResult.ok) {
          break;
        }

        await sleep(1000);
      }

      await handleConnect()
      userDomain.setAppState({ type: 'authenticated' });

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
      <Match when={userDomain.getAppState().type === 'authenticated'}>
        <App />
      </Match>
    </Switch>
  );
};

export default AuthHandler;
