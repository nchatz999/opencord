import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Plus } from "lucide-solid";
import { useModal, useRole, useAuth } from "../store/index";
import type { Role } from "../model";
import Button from "../components/Button";
import RoleSection from "../features/role/RoleSection";
interface RightPanelProps {
    class: string;
}

const RightPanel: Component<RightPanelProps> = (props) => {
    const [, modalActions] = useModal();
    const [, roleActions] = useRole();
    const [, authActions] = useAuth();
    const user = () => authActions.getUser();

    const handleCreateRole = () => {
        modalActions.open({ type: "createRole" })
    };

    const handleRoleClick = (role: Role) => {
        if (role.roleId === 1 || role.roleId === 2) return;
        modalActions.open({ type: "roleSettings", roleId: role.roleId })
    };

    return (
        <div class={`bg-bg-elevated w-64 flex flex-col h-full ${props.class || ""}`}>
            {}
            <div class="h-12 px-4 flex items-center justify-between border-b border-border-base shadow-sm shrink-0">
                <h2 class="text-fg-base font-semibold text-sm uppercase">Roles</h2>
                <Show when={user().roleId === 1}>
                    <Button
                        onClick={handleCreateRole}
                        variant="ghost"
                        size="sm"
                        class="text-fg-muted hover:text-fg-base transition-colors"
                        title="Create Role"
                    >
                        <Plus size={16} />
                    </Button>
                </Show>
            </div>

            {}
            <div class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                <div class="p-2 space-y-1">
                    <For each={roleActions.list()}>
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
