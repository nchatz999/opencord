import { createStore } from "solid-js/store";
import { createRoot, createEffect } from "solid-js";
import { usePreference } from "./preference";

export interface Theme {
  name: string;
  label: string;
  colors: Record<string, string>;
}

const baseColors = {
  "status-online": "#22c55e",
  "status-away": "#eab308",
  "status-dnd": "#ef4444",
  "status-offline": "#6b7280",
  "success": "#22c55e",
  "warning": "#eab308",
  "danger": "#ef4444",
  "info": "#00A8FC",
  "neutral": "#6b7280",
  "toast-success": "#22c55e",
  "toast-error": "#ef4444",
  "transparent": "transparent",
};

export const themes: Theme[] = [
  {
    name: "discord",
    label: "Discord",
    colors: {
      ...baseColors,
      "background": "#313338",
      "background-dark": "#1e1f22",
      "card": "#2f3136",
      "popover": "#36393f",
      "muted": "#383a40",
      "accent": "#404249",
      "sidebar": "#2b2d31",
      "input": "#202225",
      "context-menu": "#18191c",
      "primary": "#5865f2",
      "primary-hover": "#4752c4",
      "primary-foreground": "#ffffff",
      "secondary": "#4f545c",
      "secondary-hover": "#5d6269",
      "secondary-foreground": "#ffffff",
      "destructive": "#f04747",
      "destructive-hover": "#d84040",
      "destructive-foreground": "#ffffff",
      "foreground": "#DBDEE1",
      "foreground-bright": "#f2f3f5",
      "muted-foreground": "#949ba4",
      "muted-foreground-dark": "#72767d",
      "secondary-text": "#b9bbbe",
      "tab-inactive": "#8e9297",
      "border": "#1e1f22",
      "border-subtle": "#2b2d31",
      "border-card": "#4f545c",
      "ring": "#5865f2",
      "link": "#00A8FC",
      "action-positive": "#16a34a",
      "action-positive-hover": "#15803d",
      "action-negative": "#dc2626",
      "action-negative-hover": "#b91c1c",
      "syntax-keyword": "#c084fc",
      "syntax-string": "#4ade80",
      "syntax-number": "#60a5fa",
      "syntax-boolean": "#f472b6",
      "syntax-null": "#9ca3af",
      "syntax-comment": "#6b7280",
      "syntax-function": "#60a5fa",
      "syntax-punctuation": "#9ca3af",
      "syntax-date": "#facc15",
      "chart-1": "#5865f2",
      "chart-2": "#00A8FC",
      "chart-3": "#22c55e",
      "chart-4": "#eab308",
      "chart-5": "#ef4444",
      "dis-white": "#f2f3f5",
      "dis-gray": "#949ba4",
    },
  },
  {
    name: "dracula",
    label: "Dracula",
    colors: {
      ...baseColors,
      "background": "#282a36",
      "background-dark": "#1e1f29",
      "card": "#2d303d",
      "popover": "#343746",
      "muted": "#3a3d4e",
      "accent": "#44475a",
      "sidebar": "#21222c",
      "input": "#1a1b23",
      "context-menu": "#15161d",
      "primary": "#bd93f9",
      "primary-hover": "#a77bf2",
      "primary-foreground": "#282a36",
      "secondary": "#44475a",
      "secondary-hover": "#525669",
      "secondary-foreground": "#f8f8f2",
      "destructive": "#ff5555",
      "destructive-hover": "#e64545",
      "destructive-foreground": "#282a36",
      "foreground": "#f8f8f2",
      "foreground-bright": "#ffffff",
      "muted-foreground": "#9da0b3",
      "muted-foreground-dark": "#6272a4",
      "secondary-text": "#bfc2d4",
      "tab-inactive": "#8b8fa8",
      "border": "#1e1f29",
      "border-subtle": "#2d303d",
      "border-card": "#44475a",
      "ring": "#bd93f9",
      "link": "#8be9fd",
      "action-positive": "#50fa7b",
      "action-positive-hover": "#40d866",
      "action-negative": "#ff5555",
      "action-negative-hover": "#e64545",
      "syntax-keyword": "#ff79c6",
      "syntax-string": "#f1fa8c",
      "syntax-number": "#bd93f9",
      "syntax-boolean": "#ff79c6",
      "syntax-null": "#6272a4",
      "syntax-comment": "#6272a4",
      "syntax-function": "#50fa7b",
      "syntax-punctuation": "#f8f8f2",
      "syntax-date": "#ffb86c",
      "chart-1": "#bd93f9",
      "chart-2": "#8be9fd",
      "chart-3": "#50fa7b",
      "chart-4": "#f1fa8c",
      "chart-5": "#ff5555",
      "dis-white": "#f8f8f2",
      "dis-gray": "#9da0b3",
    },
  },
  {
    name: "gruvbox",
    label: "Gruvbox",
    colors: {
      ...baseColors,
      "background": "#282828",
      "background-dark": "#1d2021",
      "card": "#32302f",
      "popover": "#3c3836",
      "muted": "#3c3836",
      "accent": "#504945",
      "sidebar": "#1d2021",
      "input": "#1d2021",
      "context-menu": "#1d2021",
      "primary": "#d79921",
      "primary-hover": "#b57614",
      "primary-foreground": "#1d2021",
      "secondary": "#504945",
      "secondary-hover": "#665c54",
      "secondary-foreground": "#ebdbb2",
      "destructive": "#fb4934",
      "destructive-hover": "#cc241d",
      "destructive-foreground": "#1d2021",
      "foreground": "#ebdbb2",
      "foreground-bright": "#fbf1c7",
      "muted-foreground": "#a89984",
      "muted-foreground-dark": "#7c6f64",
      "secondary-text": "#bdae93",
      "tab-inactive": "#928374",
      "border": "#1d2021",
      "border-subtle": "#32302f",
      "border-card": "#504945",
      "ring": "#d79921",
      "link": "#83a598",
      "action-positive": "#b8bb26",
      "action-positive-hover": "#98971a",
      "action-negative": "#fb4934",
      "action-negative-hover": "#cc241d",
      "syntax-keyword": "#fb4934",
      "syntax-string": "#b8bb26",
      "syntax-number": "#d3869b",
      "syntax-boolean": "#d3869b",
      "syntax-null": "#928374",
      "syntax-comment": "#928374",
      "syntax-function": "#fabd2f",
      "syntax-punctuation": "#ebdbb2",
      "syntax-date": "#fe8019",
      "chart-1": "#d79921",
      "chart-2": "#83a598",
      "chart-3": "#b8bb26",
      "chart-4": "#fe8019",
      "chart-5": "#fb4934",
      "dis-white": "#fbf1c7",
      "dis-gray": "#a89984",
    },
  },
  {
    name: "nord",
    label: "Nord",
    colors: {
      ...baseColors,
      "background": "#2e3440",
      "background-dark": "#242933",
      "card": "#3b4252",
      "popover": "#434c5e",
      "muted": "#434c5e",
      "accent": "#4c566a",
      "sidebar": "#242933",
      "input": "#242933",
      "context-menu": "#242933",
      "primary": "#88c0d0",
      "primary-hover": "#6eb3c2",
      "primary-foreground": "#2e3440",
      "secondary": "#4c566a",
      "secondary-hover": "#5a657a",
      "secondary-foreground": "#eceff4",
      "destructive": "#bf616a",
      "destructive-hover": "#a5525a",
      "destructive-foreground": "#2e3440",
      "foreground": "#d8dee9",
      "foreground-bright": "#eceff4",
      "muted-foreground": "#9da5b4",
      "muted-foreground-dark": "#7b8394",
      "secondary-text": "#b8c0ce",
      "tab-inactive": "#8a919e",
      "border": "#242933",
      "border-subtle": "#3b4252",
      "border-card": "#4c566a",
      "ring": "#88c0d0",
      "link": "#81a1c1",
      "action-positive": "#a3be8c",
      "action-positive-hover": "#8faa78",
      "action-negative": "#bf616a",
      "action-negative-hover": "#a5525a",
      "syntax-keyword": "#81a1c1",
      "syntax-string": "#a3be8c",
      "syntax-number": "#b48ead",
      "syntax-boolean": "#81a1c1",
      "syntax-null": "#7b8394",
      "syntax-comment": "#616e88",
      "syntax-function": "#88c0d0",
      "syntax-punctuation": "#d8dee9",
      "syntax-date": "#ebcb8b",
      "chart-1": "#88c0d0",
      "chart-2": "#81a1c1",
      "chart-3": "#a3be8c",
      "chart-4": "#ebcb8b",
      "chart-5": "#bf616a",
      "dis-white": "#eceff4",
      "dis-gray": "#9da5b4",
    },
  },
  {
    name: "monokai",
    label: "Monokai",
    colors: {
      ...baseColors,
      "background": "#272822",
      "background-dark": "#1e1f1c",
      "card": "#2d2e27",
      "popover": "#3e3d32",
      "muted": "#3e3d32",
      "accent": "#49483e",
      "sidebar": "#1e1f1c",
      "input": "#1e1f1c",
      "context-menu": "#1e1f1c",
      "primary": "#a6e22e",
      "primary-hover": "#8bc425",
      "primary-foreground": "#272822",
      "secondary": "#49483e",
      "secondary-hover": "#5a594d",
      "secondary-foreground": "#f8f8f2",
      "destructive": "#f92672",
      "destructive-hover": "#d81e5f",
      "destructive-foreground": "#272822",
      "foreground": "#f8f8f2",
      "foreground-bright": "#ffffff",
      "muted-foreground": "#a6a69c",
      "muted-foreground-dark": "#75715e",
      "secondary-text": "#c5c5bb",
      "tab-inactive": "#8f8f85",
      "border": "#1e1f1c",
      "border-subtle": "#2d2e27",
      "border-card": "#49483e",
      "ring": "#a6e22e",
      "link": "#66d9ef",
      "action-positive": "#a6e22e",
      "action-positive-hover": "#8bc425",
      "action-negative": "#f92672",
      "action-negative-hover": "#d81e5f",
      "syntax-keyword": "#f92672",
      "syntax-string": "#e6db74",
      "syntax-number": "#ae81ff",
      "syntax-boolean": "#ae81ff",
      "syntax-null": "#75715e",
      "syntax-comment": "#75715e",
      "syntax-function": "#a6e22e",
      "syntax-punctuation": "#f8f8f2",
      "syntax-date": "#fd971f",
      "chart-1": "#a6e22e",
      "chart-2": "#66d9ef",
      "chart-3": "#f92672",
      "chart-4": "#e6db74",
      "chart-5": "#ae81ff",
      "dis-white": "#f8f8f2",
      "dis-gray": "#a6a69c",
    },
  },
];

interface ThemeState {
  current: string;
}

interface ThemeActions {
  setTheme: (name: string) => void;
  getTheme: () => Theme;
  getThemes: () => Theme[];
}

export type ThemeStore = [ThemeState, ThemeActions];

const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }
};

function createThemeStore(): ThemeStore {
  const [, preferenceActions] = usePreference();
  const savedTheme = preferenceActions.get<string>("theme") || "discord";

  const [state, setState] = createStore<ThemeState>({
    current: savedTheme,
  });

  const getTheme = () => themes.find((t) => t.name === state.current) || themes[0];

  createEffect(() => {
    applyTheme(getTheme());
  });

  const actions: ThemeActions = {
    setTheme(name: string) {
      const theme = themes.find((t) => t.name === name);
      if (theme) {
        setState("current", name);
        preferenceActions.set("theme", name);
        applyTheme(theme);
      }
    },

    getTheme() {
      return getTheme();
    },

    getThemes() {
      return themes;
    },
  };

  return [state, actions];
}

let instance: ThemeStore | null = null;

export function useTheme(): ThemeStore {
  if (!instance) {
    createRoot(() => {
      instance = createThemeStore();
    });
  }
  return instance!;
}
