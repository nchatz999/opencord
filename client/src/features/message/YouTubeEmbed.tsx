import type { Component } from "solid-js";

const YouTubeEmbed: Component<{ id: string }> = (props) => (
  <a
    href={`https://www.youtube.com/watch?v=${props.id}`}
    target="_blank"
    rel="noopener noreferrer"
    class="block mt-2 w-full max-w-xs"
  >
    <div class="relative rounded-md border border-border-card overflow-hidden group">
      <img
        src={`https://img.youtube.com/vi/${props.id}/0.jpg`}
        alt="Youtube thumbnail"
        width={480}
        height={360}
        class="w-full h-auto object-cover group-hover:brightness-110 transition-all"
      />
      <div class="absolute top-1 right-1 bg-action-negative text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded">
        YouTube
      </div>
    </div>
  </a>
);

export default YouTubeEmbed;
