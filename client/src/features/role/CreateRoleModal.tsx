import type { Component } from "solid-js";
import { createSignal, createMemo, For } from "solid-js";
import { Shield, X } from "lucide-solid";
import { RIGHTS } from "../../model";
import { useGroup, useModal, useRole, useAcl } from "../../store/index";
import { Input } from "../../components/Input";
import Button from "../../components/Button";
import { useToaster } from "../../components/Toaster";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";

const CreateRoleModal: Component = () => {
  const [, groupActions] = useGroup();
  const [, modalActions] = useModal();
  const [, roleActions] = useRole();
  const [, aclActions] = useAcl();
  const { addToast } = useToaster();

  const [name, setName] = createSignal("");
  const [groupRights, setGroupRights] = createSignal<Record<number, number>>({});

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
                            checked={groupRights()[group.groupId] >= (right as number)}
                            onChange={(checked) => {
                              setGroupRights((prev) => ({
                                ...prev,
                                [group.groupId]: checked
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
          </Card>
        </div>
      ),
    },
  ]);

  const handleCreate = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      addToast("Please enter a role name", "error");
      return;
    }

    const result = await roleActions.create(trimmedName);

    if (result.isErr()) {
      addToast(`Failed to create role: ${result.error}`, "error");
      return;
    }

    const roleId = result.value.roleId;

    for (const [groupId, right] of Object.entries(groupRights())) {
      const aclResult = await aclActions.grant({
        groupId: Number(groupId),
        roleId: Number(roleId),
        rights: right,
      });

      if (aclResult.isErr()) {
        addToast(`Failed to set permissions: ${aclResult.error}`, "error");
        return;
      }
    }

    modalActions.close();
  };

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield class="w-6 h-6" />
            Create Role
          </h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />

        <div class="mt-6 flex justify-end gap-2">
          <Button onClick={() => modalActions.close()} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={!name().trim()}
            onClick={handleCreate}
            variant="primary"
          >
            Create Role
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateRoleModal;
