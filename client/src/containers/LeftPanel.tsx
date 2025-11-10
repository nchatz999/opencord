import type { Component } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { useToaster } from "../components/Toaster";
import { ChannelType, type Channel, type User } from "../model";
import { groupDomain, messageDomain, microphone, modalDomain, userDomain, voipDomain } from "../store";
import { ChannelBrowser } from "../channel/ChannelBrowser";
import { UserBrowser } from "../user/UserBrowser";
import { Tabs } from "../components/Tabs";
import UserPanel from "../user/UserPanel";
import { fetchApi } from "../utils";

const LeftPanel: Component = () => {
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<number>>(
    new Set()
  );

  const { addToast } = useToaster();

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

  const handleChannelClick = async (channel: Channel) => {

    if (channel.channelType === ChannelType.Text) {
      messageDomain.setContext({ type: "channel", id: channel.channelId })
    }


    if (channel.channelType === ChannelType.VoIP) {

      await microphone.start()
      await voipDomain.resume()
      const result = await fetchApi(
        `/voip/channel/${channel.channelId}/join/${microphone.getMuted()}/false`,
        {
          method: "POST",
        }
      )
      if (result.isErr()) {
        addToast(`Failed to join channel: ${result.error.reason}`, "error");
        return
      }
      voipDomain.switchContext({ type: "channel", id: channel.channelId })
    }
  };

  const handleUserClick = async (user: User) => {
    messageDomain.setContext({ type: "dm", id: user.userId })

  };

  const handleCreateChannel = () => {
    modalDomain.open({ type: "createChannel", id: 0 })
  };

  const handleCreateGroup = () => {
    modalDomain.open({ type: "createGroup", id: 0 })
  };

  const tabItems = createMemo(() => [
    {
      id: "channels",
      label: "Channels",
      icon: <Hash size={16} />,
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e1f22] scrollbar-track-transparent">
          <ChannelBrowser
            groups={groupDomain.list()}
            collapsedGroups={collapsedGroups()}
            onToggleGroup={toggleGroup}
            onChannelClick={handleChannelClick}
            onCreateChannel={handleCreateChannel}
            onCreateGroup={handleCreateGroup}
          />
        </div>
      ),
    },
    {
      id: "users",
      label: "Users",
      icon: <UsersIcon size={16} />,
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e1f22] scrollbar-track-transparent">
          <UserBrowser users={userDomain.list()} onUserClick={handleUserClick} />
        </div>
      ),
    },
  ]);

  return (
    <div class="w-60 bg-[#2b2d31] flex flex-col h-full">
      {}
      <div class="h-12 px-4 flex items-center justify-between border-b border-[#1e1f22] shadow-sm">
        <h2 class="text-[#DBDEE1] font-semibold">OpenCord</h2>
        <button
          onClick={() => modalDomain.open({ type: "serverSettings", id: 0 })}
          class="p-1.5 hover:bg-[#383a40] text-[#949ba4] hover:text-[#DBDEE1] rounded transition-all"
          title="Server Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      {}
      <div class="flex-1 flex flex-col min-h-0">
        <Tabs
          items={tabItems()}
          defaultActiveTab="channels"
          class="flex flex-col h-full"
        />
      </div>

      {}
      <UserPanel />
    </div>
  );
};

export default LeftPanel;
