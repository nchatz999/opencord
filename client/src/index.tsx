
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
import UnsupportedBrowserPage from "./pages/UnsupportedBrowserPage";
import App from "./App";
import { useApp } from "./store/app";
import { useAuth } from "./store/auth";
import { useTheme } from "./store/theme";

const Root = () => {
  const [app] = useApp();
  const [auth] = useAuth();
  useTheme();

  return (
    <ToasterProvider>
      <ConfirmProvider>
        <DevicePickerProvider>
          <ContextMenuProvider>
            <Switch>
              <Match when={app.view.type === "loading" ? app.view : false}>
                {(view) => <LoadingPage channelId={view().channelId} />}
              </Match>
              <Match when={app.view.type === "unauthenticated"}>
                <LoginPage />
              </Match>
              <Match when={app.view.type === "error" ? app.view : false}>
                {(view) => <ErrorPage error={view().error} />}
              </Match>
              <Match when={app.view.type === "unsupported"}>
                <UnsupportedBrowserPage />
              </Match>
              <Match when={app.view.type === "app"}>
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
