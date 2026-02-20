import { createSignal, createEffect, createMemo, splitProps, Show, type Component, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Image, ImageOff } from 'lucide-solid';
import { getHttpUrl } from '../lib/ServerConfig';
import { getSessionToken, cn } from '../utils';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

async function loadImage(path: string, token: string): Promise<string | null> {
    try {
        const res = await fetch(`${getHttpUrl()}${path}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) return null;
        const url = URL.createObjectURL(await res.blob());
        cache.set(path, url);
        return url;
    } catch {
        return null;
    } finally {
        pending.delete(path);
    }
}

function fetchImage(path: string, token: string): Promise<string | null> {
    const cached = cache.get(path);
    if (cached) return Promise.resolve(cached);
    const inflight = pending.get(path);
    if (inflight) return inflight;
    const promise = loadImage(path, token);
    pending.set(path, promise);
    return promise;
}

export function clearImageCache(): void {
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    pending.clear();
}

const MAX_WIDTH = 384;
const MAX_HEIGHT = 384;

const Placeholder: Component<{ state: 'loading' | 'error'; class?: string }> = (props) => {
    const bg = () => props.class ?? "bg-bg-subtle";

    const content = () => {
        switch (props.state) {
            case 'loading': return { class: cn("absolute inset-0 flex items-center justify-center animate-pulse", bg()), icon: <Image class="text-fg-muted" size={16} /> };
            case 'error': return { class: cn("absolute inset-0 flex items-center justify-center", bg()), icon: <ImageOff class="text-fg-muted" size={16} /> };
        }
    };

    return <div class={content().class}>{content().icon}</div>;
};

const Content: Component<{
    src?: string;
    class?: string;
    style?: JSX.CSSProperties;
    onLoad: () => void;
    onExpand?: () => void;
    rest: JSX.ImgHTMLAttributes<HTMLImageElement>;
}> = (props) => (
    <img
        src={props.src}
        onLoad={props.onLoad}
        onClick={props.onExpand}
        class={props.class}
        style={props.style}
        {...props.rest}
    />
);

const Lightbox: Component<{ src?: string; onClose: () => void }> = (props) => (
    <Portal>
        <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
            onClick={props.onClose}
        >
            <img src={props.src} class="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
    </Portal>
);

interface ImagePreviewProps extends Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'> {
    onLoad?: () => void;
    expandable?: boolean;
    placeholderClass?: string;
    width?: number;
    height?: number;
}

const ImagePreview: Component<ImagePreviewProps> = (props) => {
    const [local, rest] = splitProps(props, ['src', 'onLoad', 'expandable', 'class', 'placeholderClass', 'width', 'height']);
    const [url, setUrl] = createSignal<string | undefined>();
    const [state, setState] = createSignal<'loading' | 'loaded' | 'error'>('loading');
    const [expanded, setExpanded] = createSignal(false);

    const loaded = () => state() === 'loaded';
    const placeholderState = () => state() === 'error' ? 'error' : 'loading';
    const wrapperClass = () => cn("relative overflow-hidden", local.class);
    const imgClass = () => cn(!loaded() && "opacity-0", local.expandable && "cursor-pointer", local.class);

    const size = createMemo(() => {
        const { width: w, height: h } = local;
        if (!w || !h) return undefined;
        const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
        return { width: `${Math.floor(w * scale)}px`, height: `${Math.floor(h * scale)}px` };
    });

    createEffect(async () => {
        const path = local.src;
        if (!path) {
            setUrl(undefined);
            setState('error');
            return;
        }

        setState('loading');
        setUrl(undefined);

        const token = getSessionToken();
        if (!token) {
            setState('error');
            return;
        }

        const result = await fetchImage(path, token);
        if (local.src !== path) return;

        if (!result) {
            setState('error');
            return;
        }

        setUrl(result);
    });

    return (
        <div class={wrapperClass()} style={size()}>
            <Show when={!loaded()}>
                <Placeholder state={placeholderState()} class={local.placeholderClass} />
            </Show>
            <Content
                src={url()}
                class={imgClass()}
                style={size()}
                onLoad={() => { setState('loaded'); local.onLoad?.(); }}
                onExpand={local.expandable ? () => setExpanded(true) : undefined}
                rest={rest}
            />
            <Show when={expanded()}>
                <Lightbox src={url()} onClose={() => setExpanded(false)} />
            </Show>
        </div>
    );
};

export default ImagePreview;
