
import { render } from "solid-js/web";
import "./index.css";

import "./polyfills/polyfill.js";
import { ToasterProvider } from "./components/Toaster";
import { ContextMenuProvider } from "./components/ContentMenu";
import AuthHandler from "./auth/AuthHandler";

const root = document.getElementById("root");

render(
  () => (
    <ToasterProvider>
      <ContextMenuProvider>
        <AuthHandler />
      </ContextMenuProvider>
    </ToasterProvider>
  ),
  root!
);
