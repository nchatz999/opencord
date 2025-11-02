import type { Component } from "solid-js";
import { Switch, Match, Show } from "solid-js";
import { channelDomain, groupDomain, modalDomain, roleDomain } from "../store";
import GroupSettingsModal from "../group/GroupSettingsModal";
import CreateGroupModal from "../group/CreateGroupModal";
import ServerSettingsModal from "../server/ServerSettingsModal";
import CreateChannelModal from "../channel/CreateChannelModal";
import CreateRoleModal from "../role/CreateRoleModal";
import UserSettingsModal from "../user/UserSettingsModal";
import { RoleSettingsModal } from "../role/RoleSettingsModal";
import ChannelSettingsModal from "../channel/ChannelSettingsModal";



const ModalManager: Component = () => {
  
  return (
    <Switch>
      <Match when={modalDomain.getModal().type == "close"}>{null}</Match>

      <Match when={modalDomain.getModal().type == "groupSettings"}>
        <Show when={groupDomain.getGroupById(modalDomain.getModal().id)}>
          {(group) => <GroupSettingsModal group={group()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getModal().type === "channelSettings"}>
        <Show when={channelDomain.getChannelById(modalDomain.getModal().id)}>
          {(channel) => <ChannelSettingsModal channel={channel()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getModal().type === "roleSettings"}>
        <Show when={roleDomain.getRoleById(modalDomain.getModal().id)}>
          {(role) => <RoleSettingsModal role={role()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getModal().type === "userSettings"}>
        <UserSettingsModal />
      </Match>

      <Match when={modalDomain.getModal().type === "createRole"}>
        <CreateRoleModal />
      </Match>

      <Match when={modalDomain.getModal().type === "createChannel"}>
        <CreateChannelModal />
      </Match>
      <Match when={modalDomain.getModal().type === "createGroup"}>
        <CreateGroupModal />
      </Match>
      <Match when={modalDomain.getModal().type === "serverSettings"}>
        <ServerSettingsModal />
      </Match>

      <Match when={true}>z</Match>
    </Switch >
  );
};

export default ModalManager;
