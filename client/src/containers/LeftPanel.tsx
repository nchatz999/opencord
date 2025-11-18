import type { Component } from "solid-js";
import { createMemo } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { type User } from "../model";
import { groupDomain, messageDomain, modalDomain, userDomain } from "../store";
import { ChannelBrowser } from "../channel/ChannelBrowser";
import { UserBrowser } from "../user/UserBrowser";
import { Tabs } from "../components/Tabs";
import UserPanel from "../user/UserPanel";

const LeftPanel: Component = () => {



  const tabItems = createMemo(() => [
    {
      id: "channels",
      label: "Channels",
      icon: <Hash size={16} />,
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e1f22] scrollbar-track-transparent">
          <ChannelBrowser
            groups={groupDomain.list()}
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
          <UserBrowser users={userDomain.list()} />
        </div>
      ),
    },
  ]);

  return (
    <div class="w-60 bg-[#2b2d31] flex flex-col h-full">
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
