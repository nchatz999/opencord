import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { useGroup, useModal, useUser, useServer } from "../store/index";
import { ChannelBrowser } from "../channel/ChannelBrowser";
import { UserBrowser } from "../user/UserBrowser";
import { Tabs } from "../components/Tabs";
import UserPanel from "../user/UserPanel";

const LeftPanel: Component = () => {
  const [, groupActions] = useGroup();
  const [, modalActions] = useModal();
  const [, userActions] = useUser();
  const [, serverActions] = useServer();

  const serverConfig = () => serverActions.get();

  const tabItems = createMemo(() => [
    {
      id: "channels",
      label: "Channels",
      icon: <Hash size={16} />,
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <ChannelBrowser
            groups={groupActions.list()}
          />
        </div>
      ),
    },
    {
      id: "users",
      label: "Users",
      icon: <UsersIcon size={16} />,
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <UserBrowser users={userActions.list()} />
        </div>
      ),
    },
  ]);

  return (
    <div class="w-60 bg-sidebar flex flex-col h-full">
      <div class="h-12 px-4 flex items-center justify-between border-b border-border shadow-sm">
        <div class="flex items-center gap-2">
          <Show when={serverConfig()} fallback={
            <div class="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground">
              S
            </div>
          }>
            {(config) => (
              <>
                <Show
                  when={config().avatarFileId}
                  fallback={
                    <div class="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground">
                      {config().serverName.charAt(0)}
                    </div>
                  }
                >
                  {(avatarId) => (
                    <img
                      src={`/server/avatar/${avatarId()}`}
                      alt="Server avatar"
                      class="w-7 h-7 rounded-full object-cover"
                    />
                  )}
                </Show>
                <h2 class="text-foreground font-semibold truncate">
                  {config().serverName}
                </h2>
              </>
            )}
          </Show>
          <Show when={!serverConfig()}>
            <h2 class="text-foreground font-semibold">OpenCord</h2>
          </Show>
        </div>
        <button
          onClick={() => modalActions.open({ type: "serverSettings" })}
          class="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-all"
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
