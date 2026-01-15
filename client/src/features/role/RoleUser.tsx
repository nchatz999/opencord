import type { Component } from "solid-js";
import { UserStatusType, type User } from "../../model";
import { useModal } from "../../store/index";
import Avatar from "../../components/Avatar";

interface RoleUserProps {
    user: User;
}

const RoleUser: Component<RoleUserProps> = (props) => {
    const [, modalActions] = useModal();

    const handleClick = () => {
        modalActions.open({ type: "userInfo", userId: props.user.userId });
    };

    const statusColors: Record<string, string> = {
        online: "bg-presence-online",
        idle: "bg-presence-away",
        dnd: "bg-presence-dnd",
        offline: "bg-presence-offline",
    };

    const statusColor = () => statusColors[props.user.status || "online"];

    return (
        <div
            onClick={handleClick}
            class="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-overlay transition-all group cursor-pointer"
        >
            {}
            <div class="relative shrink-0">
                <Avatar
                    avatarFileId={props.user.avatarFileId}
                    alt={`${props.user.username} avatar`}
                    size="xs"
                />
                <div
                    class={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-elevated ${statusColor()}`}
                    title={props.user.status}
                />
            </div>

            {}
            <span
                class={`text-sm font-medium truncate flex-1 transition-colors ${props.user.status == UserStatusType.Offline
                    ? "text-fg-subtle"
                    : "text-fg-base"
                    }`}
            >
                {props.user.username}
            </span>

            {}
            <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                <div class="w-1 h-1 bg-fg-muted rounded-full" />
            </div>
        </div>
    );
};

export default RoleUser;
