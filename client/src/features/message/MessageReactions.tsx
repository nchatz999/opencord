import type { Component } from "solid-js";
import { For, Show, createMemo } from "solid-js";
import { useReaction, useUser } from "../../store";
import { useToaster } from "../../components/Toaster";
import { cn } from "../../utils";

interface MessageReactionsProps {
  messageId: number;
  isAuthor: boolean;
}

const MessageReactions: Component<MessageReactionsProps> = (props) => {
  const [, reactionActions] = useReaction();
  const [, userActions] = useUser();
  const { addToast } = useToaster();

  const reactionSummaries = createMemo(() => reactionActions.getSummary(props.messageId));

  const handleToggleReaction = async (emoji: string) => {
    const hasReacted = reactionActions.hasUserReacted(props.messageId, emoji);

    if (hasReacted) {
      const result = await reactionActions.removeReaction(props.messageId, emoji);
      if (result.isErr()) {
        addToast(`Failed to remove reaction: ${result.error}`, "error");
      }
    } else {
      const result = await reactionActions.addReaction(props.messageId, emoji);
      if (result.isErr()) {
        addToast(`Failed to add reaction: ${result.error}`, "error");
      }
    }
  };

  const getReactorNames = (userIds: number[]): string => {
    return userIds
      .slice(0, 5)
      .map((id) => {
        const user = userActions.findById(id);
        return user?.username || "Unknown";
      })
      .join(", ") + (userIds.length > 5 ? ` and ${userIds.length - 5} more` : "");
  };

  return (
    <Show when={reactionSummaries().length > 0}>
      <div class={cn(
        "flex flex-wrap items-center gap-1 mt-1",
        props.isAuthor ? "justify-end" : "justify-start"
      )}>
        <For each={reactionSummaries()}>
          {(summary) => (
            <button
              onClick={() => handleToggleReaction(summary.emoji)}
              title={getReactorNames(summary.userIds)}
              class={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
                summary.hasReacted
                  ? "bg-primary/20 border border-primary/50 text-foreground"
                  : "bg-muted hover:bg-accent border border-transparent text-muted-foreground"
              )}
            >
              <span class="text-sm">{summary.emoji}</span>
              <span class="font-medium">{summary.count}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default MessageReactions;
