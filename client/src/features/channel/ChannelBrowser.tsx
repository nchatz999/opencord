import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import {
    ChevronDown,
    ChevronRight,
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
