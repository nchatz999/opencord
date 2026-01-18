import type { Component } from "solid-js";
import { Show, createSignal } from "solid-js";
import { Hash, Settings, UsersIcon } from "lucide-solid";
import { useGroup, useModal, useUser, useServer, useAuth, useContext, useNotification } from "../store/index";
import { ChannelBrowser } from "../features/channel/ChannelBrowser";
import { UserBrowser } from "../features/user/UserBrowser";
import { Tabs } from "../components/Tabs";
import IncomingCallsPanel from "../features/voip/IncomingCallsPanel";
import UserPanel from "../features/user/UserPanel";
import Image from "../components/Image";

const LeftPanel: Component = () => {
    const [, groupActions] = useGroup();
    const [, modalActions] = useModal();
    const [, userActions] = useUser();
    const [, serverActions] = useServer();
    const [, authActions] = useAuth();
    const [, contextActions] = useContext();
    const notification = useNotification();

    const [activeTab, setActiveTab] = createSignal("channels");
    const user = () => authActions.getUser();
    const serverConfig = () => serverActions.get();
    const tabItems = () => [
        {
            id: "channels",
            label: "Channels",
            icon: (
                <div class="relative">
                    <Hash size={16} />
                    <Show when={notification.hasAnyChannel()}>
                        <div class="absolute -top-1 -right-1 w-2 h-2 bg-accent-primary rounded-full" />
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
                    <Show when={notification.hasAnyDM()}>
                        <div class="absolute -top-1 -right-1 w-2 h-2 bg-accent-primary rounded-full" />
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
        <div class="w-60 bg-bg-elevated flex flex-col h-full">
            <div class="h-12 px-4 flex items-center justify-between border-b border-border-base shadow-sm">
                <div class="flex items-center gap-2">
                    <Show when={serverConfig()} fallback={
                        <div class="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center text-sm font-bold text-accent-primary-fg">
                            S
                        </div>
                    }>
                        {(config) => (
                            <>
                                <Show
                                    when={config().avatarFileId}
                                    fallback={
                                        <div class="w-7 h-7 rounded-full bg-accent-primary flex items-center justify-center text-sm font-bold text-accent-primary-fg">
                                            {config().serverName.charAt(0)}
                                        </div>
                                    }
                                >
                                    {(avatarId) => (
                                        <Image
                                            src={`/server/avatar/${avatarId()}`}
                                            alt="Server avatar"
                                            class="w-7 h-7 rounded-full object-cover"
                                        />
                                    )}
                                </Show>
                                <h2 class="text-fg-base font-semibold truncate">
                                    {config().serverName}
                                </h2>
                            </>
                        )}
                    </Show>
                    <Show when={!serverConfig()}>
                        <h2 class="text-fg-base font-semibold">Opencord</h2>
                    </Show>
                </div>
                <Show when={user().roleId === 1 || user().roleId === 2}>
                    <button
                        onClick={() => modalActions.open({ type: "serverSettings" })}
                        class="p-1.5 hover:bg-bg-overlay text-fg-muted hover:text-fg-base rounded transition-all"
                        title="Server Settings"
                    >
                        <Settings size={18} />
                    </button>
                </Show>
            </div>

            <div class="flex-1 flex flex-col min-h-0">
                <Tabs
                    items={tabItems()}
                    value={activeTab()}
                    onChange={setActiveTab}
                    class="flex flex-col h-full"
                />
            </div>

            <IncomingCallsPanel />
            <UserPanel />
        </div>
    );
};

export default LeftPanel;
