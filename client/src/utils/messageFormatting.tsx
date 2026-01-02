import type { Component, JSX } from "solid-js";
import { For } from "solid-js";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_\-]{11})/g;

const SYNTAX_RULES: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, type: "comment" },
  { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, type: "string" },
  { pattern: /\b(true|false)\b/g, type: "boolean" },
  { pattern: /\b(null|undefined|nil|None)\b/g, type: "null" },
  { pattern: /\b\d+\.?\d*\b/g, type: "number" },
  { pattern: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|super|extends|implements|interface|type|enum|public|private|protected|static|readonly|fn|pub|mod|use|struct|impl|trait|def|self|lambda|yield|match|case|switch|break|continue|do|in|of|as|is|not|and|or|with|finally|raise|except|pass|elif|goto|sizeof|typedef|extern|register|volatile|union)\b/g, type: "keyword" },
  { pattern: /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, type: "function" },
  { pattern: /([{}[\]();,.])/g, type: "punctuation" },
  { pattern: /[a-zA-Z_][a-zA-Z0-9_]*/g, type: "text" },
];

const TOKEN_CLASSES: Record<string, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  number: "text-syntax-number",
  boolean: "text-syntax-boolean",
  null: "text-syntax-null",
  comment: "text-syntax-comment italic",
  function: "text-syntax-function",
  punctuation: "text-syntax-punctuation",
  text: "text-foreground",
};

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

type Token = { type: string; content: string };

const tokenize = (code: string): Token[] => {
  const tokens: Token[] = [];
  let remaining = code;

  while (remaining.length > 0) {
    let matched = false;

    for (const rule of SYNTAX_RULES) {
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(remaining);

      if (match && match.index === 0) {
        tokens.push({ type: rule.type, content: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      if (tokens.length > 0 && tokens[tokens.length - 1].type === "text") {
        tokens[tokens.length - 1].content += remaining[0];
      } else {
        tokens.push({ type: "text", content: remaining[0] });
      }
      remaining = remaining.slice(1);
    }
  }

  return tokens;
};

const parseSegments = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match;

  CODE_BLOCK_REGEX.lastIndex = 0;
  while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.substring(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[2].trim(), language: match[1] || "" });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.substring(lastIndex) });
  }

  return segments;
};

const formatInlineCode = (text: string, linkClass: string): JSX.Element => {
  const parts: JSX.Element[] = [];
  let lastIndex = 0;
  let match;

  INLINE_CODE_REGEX.lastIndex = 0;
  while ((match = INLINE_CODE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatLinks(text.substring(lastIndex, match.index), linkClass));
    }
    parts.push(
      <code class="bg-card px-1.5 py-0.5 rounded text-sm font-mono text-foreground">
        {match[1]}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(formatLinks(text.substring(lastIndex), linkClass));
  }

  return <>{parts}</>;
};

const HighlightedCode: Component<{ code: string }> = (props) => {
  const tokens = () => tokenize(props.code);

  return (
    <For each={tokens()}>
      {(token) => (
        <span class={TOKEN_CLASSES[token.type] || "text-foreground"}>
          {token.content}
        </span>
      )}
    </For>
  );
};

const CodeBlock: Component<{ content: string; language: string }> = (props) => {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.content);
  };

  return (
    <div class="relative group my-2">
      <div class="flex items-center justify-between bg-sidebar px-3 py-1.5 rounded-t border-b border-border">
        <span class="text-xs text-muted-foreground font-mono">
          {props.language || "code"}
        </span>
        <button
          onClick={handleCopy}
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Copy
        </button>
      </div>
      <pre class="bg-sidebar p-3 rounded-b overflow-x-auto">
        <code class="text-sm font-mono whitespace-pre">
          <HighlightedCode code={props.content} />
        </code>
      </pre>
    </div>
  );
};

export const formatLinks = (text: string | null, linkClass: string, preventClick = false): JSX.Element => {
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
};

export const formatMessageText = (
  text: string | null,
  isOwner: boolean,
  type: "direct" | "channel"
): JSX.Element => {
  if (!text) return <></>;
  const linkClass = type === "direct" && isOwner
    ? "text-link hover:text-primary-foreground hover:underline"
    : "text-link hover:text-foreground-bright hover:underline";

  const segments = parseSegments(text);

  return (
    <>
      {segments.map((segment) =>
        segment.type === "code" ? (
          <CodeBlock content={segment.content} language={segment.language} />
        ) : (
          formatInlineCode(segment.content, linkClass)
        )
      )}
    </>
  );
};

export const extractYoutubeIds = (text: string | null): string[] => {
  if (!text) return [];
  return Array.from(text.matchAll(YOUTUBE_REGEX), (match) => match[1]);
};
