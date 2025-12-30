import type { JSX } from "solid-js";

export const URL_REGEX = /(https?:\/\/[^\s]+)/g;
export const CODE_BLOCK_REGEX = /```([^`]*)```/g;
export const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]{11})/g;

export function formatLinks(text: string | null, linkClass: string, preventClick = false): JSX.Element {
  if (!text) return <></>;
  return (
    <>
      {text.split(URL_REGEX).map((part, i) =>
        i % 2 === 1 ? (
          <a
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            class={linkClass}
            onClick={preventClick ? (e) => e.preventDefault() : undefined}
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

export function formatMessageText(
  text: string | null,
  isOwner: boolean,
  type: "direct" | "channel"
): JSX.Element {
  if (!text) return <></>;
  const linkClass = type === "direct" && isOwner
    ? "text-link hover:text-primary-foreground hover:underline"
    : "text-link hover:text-foreground-bright hover:underline";

  const segments: Array<{ type: "text" | "code"; content: string }> = [];
  let lastIndex = 0;
  let match;

  while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.substring(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.substring(lastIndex) });
  }

  return (
    <>
      {segments.map((segment) =>
        segment.type === "code" ? (
          <pre class="bg-card p-3 my-2 rounded overflow-auto whitespace-pre-wrap break-words">
            <code>{segment.content}</code>
          </pre>
        ) : (
          formatLinks(segment.content, linkClass)
        )
      )}
    </>
  );
}

export function extractYoutubeIds(text: string | null): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(YOUTUBE_REGEX), match => match[1]);
}
