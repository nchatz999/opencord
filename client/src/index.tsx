
import { render } from "solid-js/web";
import { Switch, Match, Show } from "solid-js";
import "./index.css";

import "./polyfills/polyfill.js";
import { ToasterProvider } from "./components/Toaster";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { DevicePickerProvider } from "./components/DevicePicker";
import { ContextMenuProvider } from "./components/ContentMenu";
import LoginPage from "./pages/LoginPage";
import LoadingPage from "./pages/LoadingPage";
import ErrorPage from "./pages/ErrorPage";
import App from "./App";
import { useApp } from "./store/app";
import { useAuth } from "./store/auth";

const Root = () => {
  const [app] = useApp();
  const [auth] = useAuth();

  return (
    <ToasterProvider>
      <ConfirmProvider>
        <DevicePickerProvider>
          <ContextMenuProvider>
          <Switch>
            <Match when={app.view === "loading"}>
              <LoadingPage />
            </Match>
            <Match when={app.view === "unauthenticated"}>
              <LoginPage />
            </Match>
            <Match when={app.view === "error"}>
              <ErrorPage />
            </Match>
            <Match when={app.view === "app"}>
              <Show when={auth.session}>
                <App />
              </Show>
            </Match>
          </Switch>
        </ContextMenuProvider>
        </DevicePickerProvider>
      </ConfirmProvider>
    </ToasterProvider>
  );
};

const root = document.getElementById("root");

render(() => <Root />, root!);
