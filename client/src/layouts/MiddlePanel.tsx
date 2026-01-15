import type { Component } from "solid-js";
import { createMemo, Show } from "solid-js";
import { useContext } from "../store/index";
import ChatHeader from "../features/message/ChatHeader";
import ChatContent from "../features/message/ChatContent";
import MessageInput from "../features/message/MessageInput";
import StreamsContent from "../features/voip/StreamsContent";
import { Tabs } from "../components/Tabs";
import MessageNotification from "../components/MessageNotification";

const MiddlePanel: Component = () => {
    const [contextState] = useContext();

    const tabItems = createMemo(() => {
        const items = [
            {
                id: "chat",
                label: "Messages",
                content: (
                    <div class="flex flex-col h-[calc(100vh-50px)] overflow-hidden">
                        <Show when={contextState.context}>
                            {(ctx) => <ChatHeader context={ctx()} />}
                        </Show>

                        <ChatContent />
                        <Show when={contextState.context}>
                            {(ctx) => <MessageInput context={ctx()} />}
                        </Show>
                    </div>
                ),
            },
            {
                id: "streams",
                label: "Streams",
                content: <StreamsContent />,
            },
        ];

        return items;
    });

    return (
        <div class="flex-1 flex flex-col bg-bg-base h-full overflow-hidden relative">
            <Tabs items={tabItems()} defaultActiveTab="chat" class="h-full" />
            <MessageNotification />
        </div>
    );
};

export default MiddlePanel;
