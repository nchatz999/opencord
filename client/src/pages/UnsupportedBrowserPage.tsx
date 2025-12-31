import type { Component } from "solid-js";

const UnsupportedBrowserPage: Component = () => {
  return (
    <div class="min-h-screen bg-background flex items-center justify-center">
      <div class="bg-sidebar rounded-lg p-8 max-w-md w-full mx-4">
        <div class="text-center">
          <div class="w-16 h-16 bg-warning rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-primary-foreground mb-4">Browser Not Supported</h2>
          <p class="text-secondary-text mb-6">
            Opencord requires a Chromium-based browser such as Google Chrome, Microsoft Edge, Brave, or Opera.
          </p>
          <div class="space-y-2 text-sm text-muted-foreground">
            <p>Recommended browsers:</p>
            <ul class="list-disc list-inside text-left">
              <li>Google Chrome</li>
              <li>Microsoft Edge</li>
              <li>Brave</li>
              <li>Opera</li>
            </ul>
          </div>
          <div class="mt-6 pt-4 border-t border-border">
            <p class="text-secondary-text text-sm">
              Or download the Opencord desktop app for the best experience.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnsupportedBrowserPage;
