import type { Component } from "solid-js";
import { useAuth } from "../store/auth";
import { useApp } from "../store/app";
import Button from "../components/Button";

interface ErrorPageProps {
  error: string;
}

const ErrorPage: Component<ErrorPageProps> = (props) => {
  const [, authActions] = useAuth();
  const [, appActions] = useApp();

  return (
    <div class="min-h-screen bg-background flex items-center justify-center">
      <div class="bg-sidebar rounded-lg p-8 max-w-md w-full mx-4">
        <div class="text-center">
          <div class="w-16 h-16 bg-destructive rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-foreground-bright mb-4">Connection Lost</h2>
          <p class="text-secondary-text mb-6">{props.error}</p>
          <div class="space-y-3">
            <Button variant="primary" class="w-full" onClick={() => appActions.setView({ type: "loading" })}>
              Retry Connection
            </Button>
            <Button variant="secondary" class="w-full" onClick={() => {
              authActions.logout();
              appActions.setView({ type: "unauthenticated" });
            }}>
              Sign In Again
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
