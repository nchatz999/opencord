import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { groupDomain, modalDomain, userDomain, serverDomain } from "../store";
import { ChannelBrowser } from "../channel/ChannelBrowser";
import { UserBrowser } from "../user/UserBrowser";
import { Tabs } from "../components/Tabs";
import UserPanel from "../user/UserPanel";

const LeftPanel: Component = () => {
  const serverConfig = () => serverDomain.get();

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
        <div class="flex items-center gap-2">
          <Show when={serverConfig()} fallback={
            <div class="w-7 h-7 rounded-full bg-[#5865f2] flex items-center justify-center text-sm font-bold text-white">
              S
            </div>
          }>
            {(config) => (
              <>
                <Show
                  when={config().avatarFileId}
                  fallback={
                    <div class="w-7 h-7 rounded-full bg-[#5865f2] flex items-center justify-center text-sm font-bold text-white">
                      {config().serverName.charAt(0)}
                    </div>
                  }
                >
                  {(avatarId) => (
                    <img
                      src={`/api/server/avatar/${avatarId()}`}
                      alt="Server avatar"
                      class="w-7 h-7 rounded-full object-cover"
                    />
                  )}
                </Show>
                <h2 class="text-[#DBDEE1] font-semibold truncate">
                  {config().serverName}
                </h2>
              </>
            )}
          </Show>
          <Show when={!serverConfig()}>
            <h2 class="text-[#DBDEE1] font-semibold">OpenCord</h2>
          </Show>
        </div>
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
