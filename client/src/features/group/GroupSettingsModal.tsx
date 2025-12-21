import type { Component } from "solid-js";
import { createSignal, For } from "solid-js";
import { X } from "lucide-solid";
import { RIGHTS, type Group } from "../../model";
import { useModal, useRole, useGroup, useAcl } from "../../store/index";
import { Input } from "../../components/Input";
import Button from "../../components/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";

interface GroupSettingsProps {
  group: Group;
}

const GroupSettingsModal: Component<GroupSettingsProps> = (props) => {
  const [, modalActions] = useModal();
  const [, roleActions] = useRole();
  const [, groupActions] = useGroup();
  const [, aclActions] = useAcl();

  const [name, setName] = createSignal(props.group.groupName);
  const [roleRights, setRoleRights] = createSignal<Record<number, number>>(
    Object.fromEntries(
      roleActions.list()
        .filter((role) => role.roleId > 2)
        .map((role) => [
          role.roleId,
          aclActions.getGroupRights(props.group.groupId, role.roleId) ?? 0,
        ])
    )
  );

  const handleSave = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      alert("Please enter a group name");
      return;
    }

    if (trimmedName !== props.group.groupName) {
      const renameResult = await groupActions.rename(props.group.groupId, trimmedName);
      if (renameResult.isErr()) {
        alert(`Error renaming group: ${renameResult.error}`);
        return;
      }
    }

    for (const [roleId, right] of Object.entries(roleRights())) {
      const aclResult = await aclActions.grant({
        groupId: props.group.groupId,
        roleId: Number(roleId),
        rights: right,
      });

      if (aclResult.isErr()) {
        alert(`Failed to update group permissions: ${aclResult.error}`);
        return;
      }
    }

    modalActions.close();
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the group "${props.group.groupName}"?`)) {
      return;
    }

    const result = await groupActions.delete(props.group.groupId);

    if (result.isErr()) {
      alert(`Failed to delete group: ${result.error}`);
      return;
    }

    modalActions.close();
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-foreground text-2xl font-bold">Group Settings</h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Input
          value={name()}
          placeholder="Group Name"
          onChange={setName}
          class="mb-6"
        />
        <h3 class="text-foreground text-lg font-semibold mb-4">Permissions</h3>
        <div class="overflow-auto max-h-80">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Role</TableHeader>
                <For each={Object.entries(RIGHTS)}>
                  {([key]) => <TableHeader>{key}</TableHeader>}
                </For>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={roleActions.list().filter((role) => role.roleId > 2)}>
                {(role) => (
                  <TableRow>
                    <TableCell>{role.roleName}</TableCell>
                    <For each={Object.values(RIGHTS)}>
                      {(right) => (
                        <TableCell>
                          <Checkbox
                            checked={roleRights()[role.roleId] >= (right as number)}
                            onChange={(checked) => {
                              setRoleRights((prev) => ({
                                ...prev,
                                [role.roleId]: checked
                                  ? (right as number)
                                  : (right as number) >> 1,
                              }));
                            }}
                          />
                        </TableCell>
                      )}
                    </For>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </div>
        <div class="mt-6 flex justify-between items-center">
          <Button
            onClick={handleDelete}
            variant="destructive"
          >
            Delete Group
          </Button>
          <div class="flex space-x-2">
            <Button variant="secondary" onClick={() => modalActions.close()}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupSettingsModal;
