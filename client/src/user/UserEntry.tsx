import { type Component } from "solid-js";
import { MessageCircle, Phone } from "lucide-solid";
import { UserStatusType, type User } from "../model";
import { userDomain, voipDomain, microphone, messageDomain } from "../store";
import { fetchApi } from "../utils";
import { useToaster } from "../components/Toaster";

const handleUserClick = async (user: User) => {
  messageDomain.setContext({ type: "dm", id: user.userId })

};

export const UserEntry: Component<{ user: User; }> = (
  props
) => {
  const { addToast } = useToaster();


  const statusColors: Record<UserStatusType | number, string> = {
    [UserStatusType.Online]: "bg-status-online",
    [UserStatusType.Away]: "bg-status-away",
    [UserStatusType.DoNotDisturb]: "bg-status-dnd",
    [UserStatusType.Offline]: "bg-status-offline",
    0: "bg-status-offline",
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

  const isUserCallingMe = () => {
    const currentUserId = userDomain.getCurrent().userId;
    if (!currentUserId) return false;

    const userParticipant = voipDomain.findById(props.user.userId);
    return userParticipant?.recipientId === currentUserId;
  };

  const handleVoiceCall = async (e: MouseEvent) => {
    e.stopPropagation();
    const result = await fetchApi(
      `/voip/private/${props.user.userId}/join/${microphone.getMuted()}/false`,
      { method: "POST" }
    );

    if (result.isErr()) {
      addToast(`Failed to join private call: ${result.error.reason}`, 'error');
      return;
    }

    await microphone.start();
    await voipDomain.resume();
  };
  return (
    <button
      onClick={async () => await handleUserClick(props.user)}
      class={`flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-muted transition-all group ${isOffline() ? "opacity-60" : ""
        }`}
    >
      <div class="relative shrink-0">
        <img
          src={`/user/${props.user.avatarFileId}/avatar`}
          alt={props.user.username}
          class="w-8 h-8 rounded-full"
        />

        <div
          class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-sidebar ${statusColors[props.user.status || UserStatusType.Offline] ||
            "bg-status-offline"
            }`}
        />
      </div>
      <div class="flex-1 text-left min-w-0">
        <div class="flex items-center gap-1">
          <p class="text-sm text-foreground truncate">{props.user.username}</p>
          {isUserCallingMe() && (
            <Phone size={12} class="text-status-online flex-shrink-0" />
          )}
        </div>
        <p class="text-xs text-muted-foreground truncate">{statusText()}</p>
      </div>

      {}
      <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <div
          class="p-1 hover:bg-card rounded"
          title="Send Message"
          onClick={async (e) => {
            e.stopPropagation();
            await handleUserClick(props.user)
          }}
        >
          <MessageCircle
            size={14}
            class="text-muted-foreground hover:text-foreground"
          />
        </div>
        <div
          class="p-1 hover:bg-card rounded"
          title="Start Voice Call"
          onClick={handleVoiceCall}
        >
          <Phone size={14} class="text-muted-foreground hover:text-foreground" />
        </div>
      </div>
    </button>
  );
};
