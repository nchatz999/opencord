import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import {
  ChevronDown,
  ChevronRight,
  Hash,
  Users as UsersIcon,
} from "lucide-solid";

import { ChannelEntry } from "./ChannelEntry";
import type { Channel, Group } from "../model";
import { groupDomain, modalDomain } from "../store";

export const ChannelBrowser: Component<{
  groups: Group[];
  collapsedGroups: Set<number>;
  onToggleGroup: (id: number) => void;
  onChannelClick: (channel: Channel) => void;
  onCreateChannel: () => void;
  onCreateGroup: () => void;
}> = (props) => {

  return (
    <div class="p-2">
      {}
      <div class="flex items-center justify-between px-2 mb-4">
        <h3 class="text-xs font-semibold text-[#949ba4] uppercase">Organize</h3>
        <div class="flex gap-1">
          <button
            onClick={props.onCreateChannel}
            class="p-1.5 bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1] rounded transition-colors"
            title="Create a new channel"
          >
            <Hash size={16} />
          </button>
          <button
            onClick={props.onCreateGroup}
            class="p-1.5 bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1] rounded transition-colors"
            title="Create a new group"
          >
            <UsersIcon size={16} />
          </button>
        </div>
      </div>


      {}
      <For each={props.groups}>
        {(group) => {
          const groupChannels = () => groupDomain.getChannels(group.groupId);
          const isCollapsed = () => props.collapsedGroups.has(group.groupId);

          return (
            <div class="mb-4">
              <button
                onClick={() => props.onToggleGroup(group.groupId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  modalDomain.open({ type: "groupSettings", id: group.groupId })
                }}
                class="flex items-center gap-1 w-full px-2 py-1 text-xs font-semibold text-[#949ba4] uppercase hover:text-[#DBDEE1] transition-colors"
              >
                <Show
                  when={!isCollapsed()}
                  fallback={<ChevronRight size={12} />}
                >
                  <ChevronDown size={12} />
                </Show>
                {group.groupName}
              </button>

              <Show when={!isCollapsed()}>
                <div class="ml-2">
                  <For each={groupChannels()}>
                    {(channel) => (
                      <ChannelEntry
                        channel={channel}
                        onClick={async () => {
                          props.onChannelClick(channel);
                        }}
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
