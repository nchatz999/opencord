import { createSignal, createEffect, splitProps, type Component, type JSX } from 'solid-js';
import { getServerUrlOrDefault } from '../lib/ServerConfig';
import { getSessionToken } from '../utils';

const cache = new Map<string, string>();

type ImageProps = JSX.ImgHTMLAttributes<HTMLImageElement>;

const Image: Component<ImageProps> = (props) => {
  const [local, rest] = splitProps(props, ['src']);
  const [url, setUrl] = createSignal<string | undefined>(undefined);

  createEffect(async () => {
    const path = local.src;
    if (!path) {
      setUrl(undefined);
      return;
    }

    if (cache.has(path)) {
      setUrl(cache.get(path)!);
      return;
    }

    const token = getSessionToken();
    if (!token) return;

    try {
      const res = await fetch(`${getServerUrlOrDefault()}${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      cache.set(path, blobUrl);
      setUrl(blobUrl);
    } catch {}
  });

  return <img src={url()} {...rest} />;
};

export function clearImageCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

export default Image;
