import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Plus } from "lucide-solid";
import { modalDomain, roleDomain, userDomain } from "../store";
import type { Role } from "../model";
import Button from "../components/Button";
import RoleSection from "../role/RoleSection";

interface RightPanelProps {
  class: string;
}

const RightPanel: Component<RightPanelProps> = (props) => {

  const handleCreateRole = () => {
    modalDomain.open({ type: "createRole", id: 0 })
  };

  const handleRoleClick = (role: Role) => {

    if (role.roleId === 0 || role.roleId === 1) return;

    modalDomain.open({ type: "roleSettings", id: role.roleId })
  };

  return (
    <div class={`bg-[#2b2d31] w-64 flex flex-col h-full ${props.class || ""}`}>
      {}
      <div class="h-12 px-4 flex items-center justify-between border-b border-[#1e1f22] shadow-sm shrink-0">
        <h2 class="text-[#DBDEE1] font-semibold text-sm uppercase">Roles</h2>
        <Show when={userDomain.getCurrent().roleId == 0}>
          <Button
            onClick={handleCreateRole}
            variant="ghost"
            size="sm"
            class="text-[#949ba4] hover:text-[#DBDEE1] transition-colors"
            title="Create Role"
          >
            <Plus size={16} />
          </Button>
        </Show>
      </div>

      {}
      <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e1f22] scrollbar-track-transparent">
        <div class="p-2 space-y-1">
          <For each={roleDomain.list()}>
            {(role) => (
              <RoleSection role={role} onClick={() => handleRoleClick(role)} />
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
