import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import {
    ChevronDown,
    ChevronRight,
    Hash,
    Users as UsersIcon,
    Lock,
} from "lucide-solid";

import { ChannelEntry } from "./ChannelEntry";
import type { Group } from "../../model";
import { useModal, useChannel, useAcl, useAuth } from "../../store/index";

export const ChannelBrowser: Component<{ groups: Group[]; }> = (props) => {
    const [, modalActions] = useModal();
    const [, channelActions] = useChannel();
    const [, aclActions] = useAcl();
    const [, authActions] = useAuth();

    const [collapsedGroups, setCollapsedGroups] = createSignal<Set<number>>(
        new Set()
    );

    const handleCreateChannel = () => {
        modalActions.open({ type: "createChannel", groupId: 0 });
    };

    const handleCreateGroup = () => {
        modalActions.open({ type: "createGroup" });
    };

    const toggleGroup = (groupId: number) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    return (
        <div class="p-2">
            <div class="flex items-center justify-between px-2 mb-4">
                <h3 class="text-xs font-semibold text-fg-muted uppercase">Organize</h3>
                <div class="flex gap-1">
                    <button
                        onClick={handleCreateChannel}
                        class="p-1.5 bg-bg-overlay hover:bg-bg-emphasis text-fg-base rounded transition-colors"
                        title="Create a new channel"
                    >
                        <Hash size={16} />
                    </button>
                    <button
                        onClick={handleCreateGroup}
                        class="p-1.5 bg-bg-overlay hover:bg-bg-emphasis text-fg-base rounded transition-colors"
                        title="Create a new group"
                    >
                        <UsersIcon size={16} />
                    </button>
                </div>
            </div>

            <For each={props.groups}>
                {(group) => {
                    const groupChannels = () => channelActions.findByGroup(group.groupId);
                    const isCollapsed = () => collapsedGroups().has(group.groupId);
                    const isReadOnly = () => aclActions.getGroupRights(group.groupId, authActions.getUser().roleId) === 1;

                    return (
                        <div class="mb-4">
                            <button
                                onClick={() => toggleGroup(group.groupId)}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    modalActions.open({ type: "groupSettings", groupId: group.groupId });
                                }}
                                class="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-fg-muted uppercase hover:text-fg-base transition-colors disabled:opacity-50 disabled:pointer-events-none"
                                disabled={isReadOnly()}
                            >
                                <Show
                                    when={!isCollapsed()}
                                    fallback={<ChevronRight size={12} />}
                                >
                                    <ChevronDown size={12} />
                                </Show>
                                {group.groupName}
                                <Show when={isReadOnly()}>
                                    <Lock size={12} class="ml-auto" />
                                </Show>
                            </button>

                            <Show when={!isCollapsed()}>
                                <div class="ml-2">
                                    <For each={groupChannels()}>
                                        {(channel) => (
                                            <ChannelEntry
                                                channel={channel}
                                            />
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </div>
                    );
                }}
            </For>
        </div>
    );
};
