import { createSignal, createEffect, splitProps, Show, type Component, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { getHttpUrl } from '../lib/ServerConfig';
import { getSessionToken, cn } from '../utils';

const cache = new Map<string, string>();

interface ImageProps extends Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, 'onLoad'> {
  onLoad?: () => void;
  expandable?: boolean;
}

const Image: Component<ImageProps> = (props) => {
  const [local, rest] = splitProps(props, ['src', 'onLoad', 'expandable', 'class']);
  const [url, setUrl] = createSignal<string | undefined>(undefined);
  const [expanded, setExpanded] = createSignal(false);

  createEffect(async () => {
    const path = local.src;
    if (!path) {
      setUrl(undefined);
      return;
    }

    if (cache.has(path)) {
      setUrl(cache.get(path)!);
      local.onLoad?.();
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
      local.onLoad?.();
    } catch {}
  });

  return (
    <>
      <img
        src={url()}
        onClick={local.expandable ? () => setExpanded(true) : undefined}
        class={cn(local.expandable && "cursor-pointer", local.class)}
        {...rest}
      />
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

export default Image;
