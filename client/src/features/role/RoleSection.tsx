import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { ChevronDown, ChevronRight, Users } from "lucide-solid";
import RoleUser from "./RoleUser";
import type { Role } from "../../model";
import { useUser } from "../../store/index";

interface RoleSectionProps {
    role: Role;
    onClick: () => void;
}

const RoleSection: Component<RoleSectionProps> = (props) => {
    const [, userActions] = useUser();
    const [isCollapsed, setIsCollapsed] = createSignal(false);

    const toggleCollapse = (e: MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed(!isCollapsed());
    };

    const handleRoleHeaderClick = () => {
        props.onClick();
    };

    return (
        <div class="mb-2">
            {}
            <div class="flex items-center group">
                <button
                    onClick={toggleCollapse}
                    class="p-1 hover:bg-bg-overlay rounded transition-colors mr-1"
                    title={isCollapsed() ? "Expand role" : "Collapse role"}
                >
                    <Show
                        when={!isCollapsed()}
                        fallback={<ChevronRight size={12} class="text-fg-muted" />}
                    >
                        <ChevronDown size={12} class="text-fg-muted" />
                    </Show>
                </button>

                <button
                    onClick={handleRoleHeaderClick}
                    class="flex items-center gap-2 flex-1 px-2 py-1 rounded text-left transition-all hover:bg-bg-overlay cursor-pointer"
                    title={`Manage ${props.role.roleName} role`}
                >
                    {}
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span class="text-sm font-medium text-fg-base uppercase truncate">
                            {props.role.roleName}
                        </span>
                        <div class="flex items-center gap-1 text-fg-muted">
                            <Users size={12} />
                            <span class="text-xs">
                                {userActions.list().filter(u => u.roleId == props.role.roleId).length} </span>
                        </div>
                    </div>

                    {}
                    <div class="opacity-0 group-hover:opacity-100 transition-opacity">
                        <div class="w-1 h-1 bg-fg-muted rounded-full" />
                    </div>
                </button>
            </div>

            {}
            <Show
                when={!isCollapsed() && userActions.list().filter(u => u.roleId == props.role.roleId).length > 0}
            >
                <div class="ml-6 mt-1 space-y-0.5">
                    <For each={userActions.list().filter(u => u.roleId == props.role.roleId)}>
                        {(user) => <RoleUser user={user} />}
                    </For>
                </div>
            </Show>

            {}
            <Show
                when={!isCollapsed() && userActions.list().filter(u => u.roleId == props.role.roleId).length === 0}
            >
                <div class="ml-6 mt-1 px-2 py-1">
                    <span class="text-xs text-fg-subtle italic">
                        No users with this role
                    </span>
                </div>
            </Show>
        </div>
    );
};

export default RoleSection;
