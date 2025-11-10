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
      <Match when={modalDomain.getCurrent().type == "close"}>{null}</Match>

      <Match when={modalDomain.getCurrent().type == "groupSettings"}>
        <Show when={groupDomain.findById(modalDomain.getCurrent().id)}>
          {(group) => <GroupSettingsModal group={group()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getCurrent().type === "channelSettings"}>
        <Show when={channelDomain.findById(modalDomain.getCurrent().id)}>
          {(channel) => <ChannelSettingsModal channel={channel()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getCurrent().type === "roleSettings"}>
        <Show when={roleDomain.findById(modalDomain.getCurrent().id)}>
          {(role) => <RoleSettingsModal role={role()} />}
        </Show>
      </Match>

      <Match when={modalDomain.getCurrent().type === "userSettings"}>
        <UserSettingsModal />
      </Match>

      <Match when={modalDomain.getCurrent().type === "createRole"}>
        <CreateRoleModal />
      </Match>

      <Match when={modalDomain.getCurrent().type === "createChannel"}>
        <CreateChannelModal />
      </Match>
      <Match when={modalDomain.getCurrent().type === "createGroup"}>
        <CreateGroupModal />
      </Match>
      <Match when={modalDomain.getCurrent().type === "serverSettings"}>
        <ServerSettingsModal />
      </Match>

      <Match when={true}>z</Match>
    </Switch >
  );
};

export default ModalManager;
