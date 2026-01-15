import { createStore } from "solid-js/store";
import { createRoot, createEffect } from "solid-js";
import { usePreference } from "./preference";

export interface Theme {
    name: string;
    label: string;
    colors: Record<string, string>;
}

export const themes: Theme[] = [
    {
        name: "discord",
        label: "Discord",
        colors: {
            "presence-online": "#22c55e",
            "presence-away": "#eab308",
            "presence-dnd": "#ef4444",
            "presence-offline": "#6b7280",
            "transparent": "transparent",
            "bg-base": "#313338",
            "bg-subtle": "#252629",
            "bg-elevated": "#2f3136",
            "bg-overlay": "#383a40",
            "bg-emphasis": "#404249",
            "input": "#202225",
            "context-menu": "#18191c",
            "fg-base": "#E3E5E8",
            "fg-emphasis": "#F8F9FA",
            "fg-muted": "#9DA3AD",
            "fg-subtle": "#858B95",
            "border-base": "#1e1f22",
            "border-subtle": "#2b2d31",
            "border-emphasis": "#4f545c",
            "accent-primary": "#5865f2",
            "accent-primary-hover": "#4752c4",
            "accent-primary-fg": "#ffffff",
            "accent-secondary": "#4f545c",
            "accent-secondary-hover": "#5d6269",
            "accent-secondary-fg": "#ffffff",
            "accent-link": "#00A8FC",
            "focus-ring": "#5865f2",
            "status-success": "#16a34a",
            "status-success-hover": "#15803d",
            "status-danger": "#f04747",
            "status-danger-hover": "#d84040",
            "status-danger-fg": "#ffffff",
            "status-warning": "#eab308",
            "status-info": "#00A8FC",
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
        },
    },
    {
        name: "dracula",
        label: "Dracula",
        colors: {
            "presence-online": "#50fa7b",
            "presence-away": "#f1fa8c",
            "presence-dnd": "#ff5555",
            "presence-offline": "#6272a4",
            "transparent": "transparent",
            "bg-base": "#282a36",
            "bg-subtle": "#1e1f29",
            "bg-elevated": "#2d303d",
            "bg-overlay": "#3a3d4e",
            "bg-emphasis": "#44475a",
            "input": "#1a1b23",
            "context-menu": "#15161d",

            "fg-base": "#FAFAF5",
            "fg-emphasis": "#ffffff",
            "fg-muted": "#9A9DB0",
            "fg-subtle": "#83869A",

            "border-base": "#1e1f29",
            "border-subtle": "#2d303d",
            "border-emphasis": "#44475a",

            "accent-primary": "#bd93f9",
            "accent-primary-hover": "#a77bf2",
            "accent-primary-fg": "#282a36",
            "accent-secondary": "#44475a",
            "accent-secondary-hover": "#525669",
            "accent-secondary-fg": "#f8f8f2",
            "accent-link": "#8be9fd",
            "focus-ring": "#bd93f9",

            "status-success": "#50fa7b",
            "status-success-hover": "#40d866",
            "status-danger": "#ff5555",
            "status-danger-hover": "#e64545",
            "status-danger-fg": "#282a36",
            "status-warning": "#f1fa8c",
            "status-info": "#8be9fd",

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
        },
    },
    {
        name: "gruvbox",
        label: "Gruvbox",
        colors: {
            "presence-online": "#b8bb26",
            "presence-away": "#fe8019",
            "presence-dnd": "#fb4934",
            "presence-offline": "#928374",
            "transparent": "transparent",
            "bg-base": "#282828",
            "bg-subtle": "#1d2021",
            "bg-elevated": "#32302f",
            "bg-overlay": "#3c3836",
            "bg-emphasis": "#504945",
            "input": "#1d2021",
            "context-menu": "#1d2021",

            "fg-base": "#F2E5C2",
            "fg-emphasis": "#FDF4DC",
            "fg-muted": "#A89984",
            "fg-subtle": "#928374",

            "border-base": "#1d2021",
            "border-subtle": "#32302f",
            "border-emphasis": "#504945",

            "accent-primary": "#d79921",
            "accent-primary-hover": "#b57614",
            "accent-primary-fg": "#1d2021",
            "accent-secondary": "#504945",
            "accent-secondary-hover": "#665c54",
            "accent-secondary-fg": "#ebdbb2",
            "accent-link": "#83a598",
            "focus-ring": "#d79921",

            "status-success": "#b8bb26",
            "status-success-hover": "#98971a",
            "status-danger": "#fb4934",
            "status-danger-hover": "#cc241d",
            "status-danger-fg": "#1d2021",
            "status-warning": "#fe8019",
            "status-info": "#83a598",

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
        },
    },
    {
        name: "nord",
        label: "Nord",
        colors: {
            "presence-online": "#a3be8c",
            "presence-away": "#ebcb8b",
            "presence-dnd": "#bf616a",
            "presence-offline": "#4c566a",
            "transparent": "transparent",
            "bg-base": "#2e3440",
            "bg-subtle": "#242933",
            "bg-elevated": "#3b4252",
            "bg-overlay": "#434c5e",
            "bg-emphasis": "#4c566a",
            "input": "#242933",
            "context-menu": "#242933",

            "fg-base": "#E5EAF2",
            "fg-emphasis": "#F4F7FB",
            "fg-muted": "#9DA5B4",
            "fg-subtle": "#848B99",

            "border-base": "#242933",
            "border-subtle": "#3b4252",
            "border-emphasis": "#4c566a",

            "accent-primary": "#88c0d0",
            "accent-primary-hover": "#6eb3c2",
            "accent-primary-fg": "#2e3440",
            "accent-secondary": "#4c566a",
            "accent-secondary-hover": "#5a657a",
            "accent-secondary-fg": "#eceff4",
            "accent-link": "#81a1c1",
            "focus-ring": "#88c0d0",

            "status-success": "#a3be8c",
            "status-success-hover": "#8faa78",
            "status-danger": "#bf616a",
            "status-danger-hover": "#a5525a",
            "status-danger-fg": "#2e3440",
            "status-warning": "#ebcb8b",
            "status-info": "#81a1c1",

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
        },
    },
    {
        name: "monokai",
        label: "Monokai",
        colors: {
            "presence-online": "#a6e22e",
            "presence-away": "#e6db74",
            "presence-dnd": "#f92672",
            "presence-offline": "#75715e",
            "transparent": "transparent",
            "bg-base": "#272822",
            "bg-subtle": "#1e1f1c",
            "bg-elevated": "#2d2e27",
            "bg-overlay": "#3e3d32",
            "bg-emphasis": "#49483e",
            "input": "#1e1f1c",
            "context-menu": "#1e1f1c",

            "fg-base": "#FAFAF5",
            "fg-emphasis": "#FFFFFF",
            "fg-muted": "#A6A69C",
            "fg-subtle": "#8F8B78",

            "border-base": "#1e1f1c",
            "border-subtle": "#2d2e27",
            "border-emphasis": "#49483e",

            "accent-primary": "#a6e22e",
            "accent-primary-hover": "#8bc425",
            "accent-primary-fg": "#272822",
            "accent-secondary": "#49483e",
            "accent-secondary-hover": "#5a594d",
            "accent-secondary-fg": "#f8f8f2",
            "accent-link": "#66d9ef",
            "focus-ring": "#a6e22e",

            "status-success": "#a6e22e",
            "status-success-hover": "#8bc425",
            "status-danger": "#f92672",
            "status-danger-hover": "#d81e5f",
            "status-danger-fg": "#272822",
            "status-warning": "#e6db74",
            "status-info": "#66d9ef",

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
