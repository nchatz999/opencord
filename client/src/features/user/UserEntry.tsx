import { type Component, Show } from "solid-js";
import { MessageCircle, Phone } from "lucide-solid";
import Avatar from "../../components/Avatar";
import { UserStatusType, type User } from "../../model";
import { useVoip, useContext, useNotification } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import { useLiveKit } from "../../lib/livekit";

const UnreadBadge = () => (
    <span class="w-2 h-2 bg-accent-primary rounded-full shrink-0" />
);

export const UserEntry: Component<{ user: User; }> = (
    props
) => {
    const { addToast } = useToaster();
    const [, voipActions] = useVoip();
    const [, contextActions] = useContext();
    const notification = useNotification();
    const hasUnread = () => notification.hasDM(props.user.userId);
    const [, livekitActions] = useLiveKit();

    const statusColors: Record<UserStatusType | number, string> = {
        [UserStatusType.Online]: "bg-presence-online",
        [UserStatusType.Away]: "bg-presence-away",
        [UserStatusType.DoNotDisturb]: "bg-presence-dnd",
        [UserStatusType.Offline]: "bg-presence-offline",
        0: "bg-presence-offline",
    };

    const isOffline = () => props.user.status === UserStatusType.Offline;

    const statusText = () => {
        switch (props.user.status) {
            case UserStatusType.Online:
                return "Online";
            case UserStatusType.Away:
                return "Away";
            case UserStatusType.DoNotDisturb:
                return "Do Not Disturb";
            default:
                return "Offline";
        }
    };

    const handleUserClick = async (user: User) => {
        contextActions.set({ type: "dm", id: user.userId });
        notification.clearDM(user.userId);
    };

    const handleVoiceCall = async (e: MouseEvent) => {
        e.stopPropagation();

        const result = await voipActions.joinPrivate(
            props.user.userId,
            livekitActions.getMuted(),
            livekitActions.getDeafened()
        );

        if (result.isErr()) {
            addToast(`Failed to join private call: ${result.error}`, 'error');
        }
    };

    return (
        <button
            onClick={async () => await handleUserClick(props.user)}
            class={`flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-bg-overlay transition-all group ${isOffline() ? "opacity-60" : ""}`}
        >
            <div class="relative shrink-0">
                <Avatar
                    avatarFileId={props.user.avatarFileId}
                    alt={props.user.username}
                    size="sm"
                />
                <div
                    class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-elevated ${statusColors[props.user.status || UserStatusType.Offline] ||
                        "bg-presence-offline"
                        }`}
                />
            </div>
            <div class="flex-1 text-left min-w-0">
                <div class="flex items-center gap-1">
                    <p class="text-sm text-fg-base truncate">{props.user.username}</p>
                    <Show when={hasUnread()}>
                        <UnreadBadge />
                    </Show>
                </div>
                <p class="text-xs text-fg-muted truncate">{statusText()}</p>
            </div>

            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <div
                    class="p-1 hover:bg-bg-elevated rounded"
                    title="Send Message"
                    onClick={async (e) => {
                        e.stopPropagation();
                        await handleUserClick(props.user)
                    }}
                >
                    <MessageCircle
                        size={14}
                        class="text-fg-muted hover:text-fg-base"
                    />
                </div>
                <div
                    class="p-1 hover:bg-bg-elevated rounded"
                    title="Start Voice Call"
                    onClick={handleVoiceCall}
                >
                    <Phone size={14} class="text-fg-muted hover:text-fg-base" />
                </div>
            </div>
        </button>
    );
};
