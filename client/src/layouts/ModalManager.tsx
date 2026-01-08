import type { Component } from "solid-js";
import { Switch, Match, Show, createMemo } from "solid-js";
import { useChannel, useGroup, useModal, useRole, useUser } from "../store/index";
import GroupSettingsModal from "../features/group/GroupSettingsModal";
import CreateGroupModal from "../features/group/CreateGroupModal";
import ServerSettingsModal from "../features/server/ServerSettingsModal";
import CreateChannelModal from "../features/channel/CreateChannelModal";
import CreateRoleModal from "../features/role/CreateRoleModal";
import UserSettingsModal from "../features/user/UserSettingsModal";
import UserInfoModal from "../features/user/UserInfoModal";
import { RoleSettingsModal } from "../features/role/RoleSettingsModal";
import ChannelSettingsModal from "../features/channel/ChannelSettingsModal";
import VoipUserSettingsModal from "../features/voip/VoipUserSettingsModal";
import FocusedStreamModal from "../features/voip/FocusedStreamModal";
import type { CallType } from "../store/modal";
import type { MediaType } from "../model";

const ModalManager: Component = () => {
  const [modalState] = useModal();
  const [, channelActions] = useChannel();
  const [, groupActions] = useGroup();
  const [, roleActions] = useRole();

  const current = createMemo(() => modalState.modal);

  return (
    <Switch>
      <Match when={current() === null}>{null}</Match>

      <Match when={current()?.type === "groupSettings"}>
        <Show when={current()?.type === "groupSettings" && groupActions.findById((current() as { type: "groupSettings"; groupId: number }).groupId)}>
          {(group) => <GroupSettingsModal group={group()} />}
        </Show>
      </Match>

      <Match when={current()?.type === "channelSettings"}>
        <Show when={current()?.type === "channelSettings" && channelActions.findById((current() as { type: "channelSettings"; channelId: number }).channelId)}>
          {(channel) => <ChannelSettingsModal channel={channel()} />}
        </Show>
      </Match>

      <Match when={current()?.type === "roleSettings"}>
        <Show when={current()?.type === "roleSettings" && roleActions.findById((current() as { type: "roleSettings"; roleId: number }).roleId)}>
          {(role) => <RoleSettingsModal role={role()} />}
        </Show>
      </Match>

      <Match when={current()?.type === "userSettings"}>
        <UserSettingsModal />
      </Match>

      <Match when={current()?.type === "userInfo"}>
        <UserInfoModal userId={(current() as { type: "userInfo"; userId: number }).userId} />
      </Match>

      <Match when={current()?.type === "createRole"}>
        <CreateRoleModal />
      </Match>

      <Match when={current()?.type === "createChannel"}>
        <CreateChannelModal />
      </Match>
      <Match when={current()?.type === "createGroup"}>
        <CreateGroupModal />
      </Match>
      <Match when={current()?.type === "serverSettings"}>
        <ServerSettingsModal />
      </Match>

      <Match when={current()?.type === "voipUserSettings"}>
        <VoipUserSettingsModal
          publisherId={(current() as { type: "voipUserSettings"; publisherId: number; callType: CallType }).publisherId}
          callType={(current() as { type: "voipUserSettings"; publisherId: number; callType: CallType }).callType}
        />
      </Match>

      <Match when={current()?.type === "focusedStream"}>
        <FocusedStreamModal
          publisherId={(current() as { type: "focusedStream"; publisherId: number; mediaType: MediaType; callType: CallType }).publisherId}
          mediaType={(current() as { type: "focusedStream"; publisherId: number; mediaType: MediaType; callType: CallType }).mediaType}
          callType={(current() as { type: "focusedStream"; publisherId: number; mediaType: MediaType; callType: CallType }).callType}
        />
      </Match>
    </Switch>
  );
};

export default ModalManager;
