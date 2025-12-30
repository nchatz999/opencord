import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For } from "solid-js";
import { Hash, Volume2, X, Shield } from "lucide-solid";
import { ChannelType, RIGHTS } from "../../model";
import { useAcl, useGroup, useModal, useRole, useChannel } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import Button from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Input } from "../../components/Input";
import Select from "../../components/Select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";

const CreateChannelModal: Component = () => {
  const { addToast } = useToaster();
  const [, aclActions] = useAcl();
  const [, groupActions] = useGroup();
  const [, modalActions] = useModal();
  const [, roleActions] = useRole();
  const [, channelActions] = useChannel();

  const [name, setName] = createSignal("");
  const [group, setGroup] = createSignal<number | null>(null);
  const [type, setType] = createSignal<ChannelType>(ChannelType.Text);
  const [roleRights, setRoleRights] = createSignal<Record<number, number>>({});

  createEffect(() => {
    const groupId = group();
    if (groupId === null) {
      setRoleRights({});
      return;
    }
    setRoleRights(
      Object.fromEntries(
        roleActions.list()
          .filter((role) => role.roleId > 2)
          .map((role) => [
            role.roleId,
            aclActions.getGroupRights(groupId, role.roleId) || 0,
          ])
      )
    );
  });

  const tabItems = createMemo(() => [
    {
      id: "general",
      label: "General",
      content: (
        <div class="space-y-4 mt-6">
          <Card title="Channel Info" icon={<Hash class="w-4 h-4" />}>
            <div class="space-y-4">
              <Input label="Channel Name" value={name()} onChange={setName} />
              <Select
                label="Channel Type"
                options={[
                  { value: ChannelType.Text, label: "Text Channel" },
                  { value: ChannelType.VoIP, label: "Voice Channel" },
                ]}
                value={type()}
                onChange={(value) => setType(value as ChannelType)}
              />
              <Select
                label="Group"
                options={groupActions.list().map((g) => ({
                  value: g.groupId,
                  label: g.groupName,
                }))}
                value={group()}
                onChange={(value) => setGroup(value as number)}
              />
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
          <Card title="Role Permissions" icon={<Shield class="w-4 h-4" />}>
            <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Role</TableHeader>
                <For each={Object.keys(RIGHTS)}>
                  {(right) => <TableHeader align="center">{right}</TableHeader>}
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
                        <TableCell align="center">
                          <Checkbox
                            checked={roleRights()[role.roleId] >= right}
                            disabled
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

  const handleCreate = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) return;

    const groupId = group();
    if (!groupId) {
      addToast("Please select a group", "error");
      return;
    }

    const createResult = await channelActions.create(groupId, trimmedName, type());

    if (createResult.isErr()) {
      addToast(`Failed to create channel: ${createResult.error}`, "error");
      return;
    }

    modalActions.close();
  };

  const ChannelIcon = type() === ChannelType.Text ? Hash : Volume2;

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
            <ChannelIcon class="w-6 h-6" />
            Create Channel
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
            disabled={!name().trim() || group() === null}
            onClick={handleCreate}
            variant="primary"
          >
            Create Channel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateChannelModal;
