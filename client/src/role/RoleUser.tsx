import type { Component } from "solid-js";
import { UserStatusType, type User } from "../model";

interface RoleUserProps {
  user: User;
}

const RoleUser: Component<RoleUserProps> = (props) => {

  const statusColors: Record<string, string> = {
    online: "#23A55A",
    idle: "#F0B232",
    dnd: "#F23F43",
    offline: "#80848E",
  };

  const statusColor = () => statusColors[props.user.status || "online"];

  return (
    <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-[#383a40] transition-all group cursor-pointer">
      {}
      <div class="relative shrink-0">
        <img
          class="w-6 h-6 rounded-full"
          src={`/api/user/${props.user.avatarFileId}/avatar`}
          alt={`${props.user.username} avatar`}
          width={24}
          height={24}
        />
        <div
          class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#2b2d31]"
          style={{ "background-color": statusColor() }}
          title={props.user.status}
        />
      </div>

      {}
      <span
        class={`text-sm font-medium truncate flex-1 transition-colors ${props.user.status == UserStatusType.Offline
          ? "text-[#6d6f78]"
          : "text-[#DBDEE1]"
          }`}
      >
        {props.user.username}
      </span>

      {}
      <div class="opacity-0 group-hover:opacity-100 transition-opacity">
        <div class="w-1 h-1 bg-[#949ba4] rounded-full" />
      </div>
    </div>
  );
};

export default RoleUser;
