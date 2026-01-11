import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Reaction, ReactionSummary } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { useAuth } from "./auth";

interface ReactionState {
    reactions: Reaction[];
}

interface ReactionActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    list: () => Reaction[];
    findByMessageId: (messageId: number) => Reaction[];
    getSummary: (messageId: number) => ReactionSummary[];
    hasUserReacted: (messageId: number, emoji: string) => boolean;
    add: (reaction: Reaction) => void;
    remove: (messageId: number, userId: number, emoji: string) => void;
    removeByMessageId: (messageId: number) => void;
    addReaction: (messageId: number, emoji: string) => Promise<Result<void, string>>;
    removeReaction: (messageId: number, emoji: string) => Promise<Result<void, string>>;
}

export type ReactionStore = [ReactionState, ReactionActions];

function createReactionStore(): ReactionStore {
    const [state, setState] = createStore<ReactionState>({
        reactions: [],
    });

    const connection = useConnection();
    const [, authActions] = useAuth();
    let cleanupFn: (() => void) | null = null;

    const actions: ReactionActions = {
        async init() {
            actions.cleanup();

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "reactionAdded") {
                    actions.add(event.reaction);
                } else if (event.type === "reactionRemoved") {
                    actions.remove(event.messageId, event.userId, event.emoji);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("reactions", []);
        },

        list() {
            return state.reactions;
        },

        findByMessageId(messageId) {
            return state.reactions.filter((r) => r.messageId === messageId);
        },

        getSummary(messageId) {
            const currentUserId = authActions.getUser().userId;

            const reactions = actions.findByMessageId(messageId);
            const emojiMap = new Map<string, number[]>();

            for (const r of reactions) {
                const existing = emojiMap.get(r.emoji);
                if (existing) {
                    existing.push(r.userId);
                } else {
                    emojiMap.set(r.emoji, [r.userId]);
                }
            }

            const summaries: ReactionSummary[] = [];
            for (const [emoji, userIds] of emojiMap) {
                summaries.push({
                    emoji,
                    count: userIds.length,
                    userIds,
                    hasReacted: userIds.includes(currentUserId),
                });
            }

            return summaries;
        },

        hasUserReacted(messageId, emoji) {
            const currentUserId = authActions.getUser().userId;

            return state.reactions.some(
                (r) => r.messageId === messageId && r.emoji === emoji && r.userId === currentUserId
            );
        },

        add(reaction) {
            setState("reactions", (reactions) => {
                const exists = reactions.some(
                    (r) => r.messageId === reaction.messageId && r.userId === reaction.userId && r.emoji === reaction.emoji
                );

                if (exists) {
                    return reactions;
                }

                return [...reactions, reaction];
            });
        },

        remove(messageId, userId, emoji) {
            setState("reactions", (reactions) =>
                reactions.filter((r) => !(r.messageId === messageId && r.userId === userId && r.emoji === emoji))
            );
        },

        removeByMessageId(messageId) {
            setState("reactions", (reactions) => reactions.filter((r) => r.messageId !== messageId));
        },

        async addReaction(messageId, emoji) {
            const result = await request(`/message/${messageId}/reactions`, {
                method: "POST",
                body: { emoji },
            });

            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async removeReaction(messageId, emoji) {
            const result = await request(`/message/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
                method: "DELETE",
            });

            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },
    };

    return [state, actions];
}

let instance: ReactionStore | null = null;

export function useReaction(): ReactionStore {
    if (!instance) {
        createRoot(() => {
            instance = createReactionStore();
        });
    }
    return instance!;
}
