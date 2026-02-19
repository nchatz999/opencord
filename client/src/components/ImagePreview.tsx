import { createSignal, createEffect, createMemo, splitProps, Show, type Component, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { getHttpUrl } from '../lib/ServerConfig';
import { getSessionToken, cn } from '../utils';

const cache = new Map<string, string>();

const MAX_WIDTH = 384;
const MAX_HEIGHT = 384;

interface ImagePreviewProps extends Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'> {
  onLoad?: () => void;
  expandable?: boolean;
  width?: number;
  height?: number;
}

const ImagePreview: Component<ImagePreviewProps> = (props) => {
  const [local, rest] = splitProps(props, ['src', 'onLoad', 'expandable', 'class', 'width', 'height']);
  const [url, setUrl] = createSignal<string | undefined>();
  const [loaded, setLoaded] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);

  const size = createMemo(() => {
    const { width: w, height: h } = local;
    if (!w || !h || w <= 0 || h <= 0) return undefined;
    const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
    return { width: `${Math.floor(w * scale)}px`, height: `${Math.floor(h * scale)}px` };
  });

  createEffect(async () => {
    const path = local.src;
    if (!path) {
      setUrl(undefined);
      setLoaded(false);
      return;
    }

    if (cache.has(path)) {
      setUrl(cache.get(path)!);
      return;
    }

    const token = getSessionToken();
    if (!token) return;

    try {
      const res = await fetch(`${getHttpUrl()}${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      cache.set(path, blobUrl);
      setUrl(blobUrl);
    } catch {}
  });

  return (
    <>
      <div class="relative block" style={size()}>
        <Show when={size() && !loaded()}>
          <div class="absolute inset-0 rounded-lg bg-bg-subtle animate-pulse" />
        </Show>
        <img
          src={url()}
          onLoad={() => { setLoaded(true); local.onLoad?.(); }}
          onClick={local.expandable ? () => setExpanded(true) : undefined}
          class={cn(local.expandable && "cursor-pointer", size() && !loaded() && "opacity-0", local.class)}
          style={size()}
          {...rest}
        />
      </div>
      <Show when={expanded()}>
        <Portal>
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
            onClick={() => setExpanded(false)}
          >
            <img src={url()} class="max-w-[90vw] max-h-[90vh] object-contain" />
          </div>
        </Portal>
      </Show>
    </>
  );
};

export function clearImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

export default ImagePreview;
