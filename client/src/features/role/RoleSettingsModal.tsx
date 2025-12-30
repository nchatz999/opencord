import type { Component } from "solid-js";
import { createSignal, createMemo, For } from "solid-js";
import { Search, Shield, X, Users } from "lucide-solid";
import { RIGHTS, type Role } from "../../model";
import { useAcl, useGroup, useModal, useUser, useRole } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { Input } from "../../components/Input";
import Button from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";
import Avatar from "../../components/Avatar";

interface RoleSettingsModalProps {
  role: Role;
}

export const RoleSettingsModal: Component<RoleSettingsModalProps> = (props) => {
  const [, aclActions] = useAcl();
  const [, groupActions] = useGroup();
  const [, modalActions] = useModal();
  const [, userActions] = useUser();
  const [, roleActions] = useRole();
  const { addToast } = useToaster();
  const confirm = useConfirm();

  const [name, setName] = createSignal(props.role.roleName);
  const [searchTerm, setSearchTerm] = createSignal("");

  const [groupRights] = createSignal<Record<number, number>>(
    Object.fromEntries(
      groupActions.list().map((group) => [
        group.groupId,
        aclActions.getGroupRights(group.groupId, props.role.roleId) ?? 0,
      ])
    )
  );

  const filteredUsers = createMemo(() =>
    userActions.list()
      .filter((user) => user.roleId === props.role.roleId)
      .filter((user) =>
        user.username.toLowerCase().includes(searchTerm().toLowerCase())
      )
  );

  const tabItems = createMemo(() => [
    {
      id: "general",
      label: "General",
      content: (
        <div class="space-y-4 mt-6">
          <Card title="Role Info" icon={<Shield class="w-4 h-4" />}>
            <Input label="Role Name" value={name()} onChange={setName} />
          </Card>
        </div>
      ),
    },
    {
      id: "users",
      label: "Users",
      content: (
        <div class="space-y-4 mt-6">
          <Card title="Role Members" icon={<Users class="w-4 h-4" />}>
            <div class="space-y-4">
              <Input
                value={searchTerm()}
                onChange={setSearchTerm}
                placeholder="Search users..."
                icon={<Search class="w-4 h-4 text-muted-foreground" />}
              />
              <ul class="space-y-2 max-h-80 overflow-y-auto">
                <For each={filteredUsers()}>
                  {(user) => (
                    <li class="flex items-center gap-2 bg-muted p-2 rounded">
                      <Avatar
                        avatarFileId={user.avatarFileId}
                        alt={user.username}
                        size="sm"
                      />
                      <span class="text-foreground">{user.username}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Card>
        </div>
      ),
    },
    {
      id: "permissions",
      label: "Permissions",
      content: (
        <div class="space-y-4 mt-6">
          <Card title="Group Permissions" icon={<Shield class="w-4 h-4" />}>
            <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Group</TableHeader>
                <For each={Object.keys(RIGHTS)}>
                  {(right) => <TableHeader align="center">{right}</TableHeader>}
                </For>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={groupActions.list()}>
                {(group) => (
                  <TableRow>
                    <TableCell>{group.groupName}</TableCell>
                    <For each={Object.values(RIGHTS)}>
                      {(right) => (
                        <TableCell align="center">
                          <Checkbox
                            disabled
                            checked={groupRights()[group.groupId] >= (right as number)}
                            onChange={() => {}}
                          />
                        </TableCell>
                      )}
                    </For>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
          </Card>
        </div>
      ),
    },
  ]);

  const handleSave = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) return;

    if (trimmedName !== props.role.roleName) {
      const result = await roleActions.rename(props.role.roleId, trimmedName);
      if (result.isErr()) {
        addToast(`Failed to rename role: ${result.error}`, "error");
        return;
      }
    }

    modalActions.close();
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Role",
      message: `Are you sure you want to delete the role "${props.role.roleName}"?`,
      confirmText: "Delete",
      variant: "danger",
    });
    if (!confirmed) return;

    const result = await roleActions.delete(props.role.roleId);

    if (result.isErr()) {
      addToast(`Failed to delete role: ${result.error}`, "error");
      return;
    }

    modalActions.close();
  };

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield class="w-6 h-6" />
            Role Settings
          </h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />

        <div class="mt-6 flex justify-between items-center">
          <Button onClick={handleDelete} variant="destructive">
            Delete Role
          </Button>
          <div class="flex gap-2">
            <Button onClick={() => modalActions.close()} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={!name().trim()}
              onClick={handleSave}
              variant="primary"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoleSettingsModal;
