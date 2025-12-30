import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { useGroup, useModal, useUser, useServer, useAuth, useContext } from "../store/index";
import { ChannelBrowser } from "../features/channel/ChannelBrowser";
import { UserBrowser } from "../features/user/UserBrowser";
import { Tabs } from "../components/Tabs";
import IncomingCallsPanel from "../features/voip/IncomingCallsPanel";
import UserPanel from "../features/user/UserPanel";

const LeftPanel: Component = () => {
  const [, groupActions] = useGroup();
  const [, modalActions] = useModal();
  const [, userActions] = useUser();
  const [, serverActions] = useServer();
  const [, authActions] = useAuth();
  const [, contextActions] = useContext();

  const user = () => authActions.getUser();
  const serverConfig = () => serverActions.get();
  const tabItems = () => [
    {
      id: "channels",
      label: "Channels",
      icon: (
        <div class="relative">
          <Hash size={16} />
          <Show when={contextActions.hasAnyUnread("channel")}>
            <div class="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
          </Show>
        </div>
      ),
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
      icon: (
        <div class="relative">
          <UsersIcon size={16} />
          <Show when={contextActions.hasAnyUnread("dm")}>
            <div class="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
          </Show>
        </div>
      ),
      content: (
        <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          <UserBrowser users={userActions.list()} />
        </div>
      ),
    },
  ];

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
            <h2 class="text-foreground font-semibold">Opencord</h2>
          </Show>
        </div>
        <Show when={user().roleId === 1 || user().roleId === 2}>
          <button
            onClick={() => modalActions.open({ type: "serverSettings" })}
            class="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded transition-all"
            title="Server Settings"
          >
            <Settings size={18} />
          </button>
        </Show>
      </div>

      <div class="flex-1 flex flex-col min-h-0">
        <Tabs
          items={tabItems()}
          defaultActiveTab="channels"
          class="flex flex-col h-full"
        />
      </div>

      <IncomingCallsPanel />
      <UserPanel />
    </div>
  );
};

export default LeftPanel;
