import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For } from "solid-js";
import { Hash, Volume2, X } from "lucide-solid";
import { ChannelType, RIGHTS, type Channel } from "../model";
import { aclDomain, modalDomain, roleDomain } from "../store";
import { useToaster } from "../components/Toaster";
import Button from "../components/Button";
import { Tabs } from "../components/Tabs";
import { Input } from "../components/Input";
import { fetchApi } from "../utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/Table";
import Checkbox from "../components/CheckBox";

interface ChannelSettingsProps {
  channel: Channel;
}

const ChannelSettingsModal: Component<ChannelSettingsProps> = (props) => {
  const { addToast } = useToaster();


  const [name, setName] = createSignal(props.channel.channelName);
  const [roleRights, setRoleRights] = createSignal<Record<number, number>>({});

  createEffect(() => {
    setRoleRights(
      Object.fromEntries(
        roleDomain.list()
          .filter((role) => role.roleId > 1)
          .map((role) => [
            role.roleId,
            aclDomain.getGroupRights(props.channel.groupId, role.roleId) || 0,
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
          <Input label="Channel Name" value={name()} onChange={setName} />
        </div>
      ),
    },
    {
      id: 'permissions',
      label: 'Permissions',
      content: (
        <div class="h-full overflow-hidden flex flex-col h-96 mt-6">
          <div class="flex-grow overflow-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader class="sticky left-0 z-20">
                    Role / Channel
                  </TableHeader>
                  <For each={Object.entries(RIGHTS)}>
                    {([key]) => <TableHeader>{key}</TableHeader>}
                  </For>
                </TableRow>
              </TableHead>
              <TableBody>
                <For each={roleDomain.list().filter((role) => role.roleId > 1)}>
                  {(role) => (
                    <TableRow>
                      <TableCell>{role.roleName}</TableCell>

                      <For each={Object.values(RIGHTS)}>
                        {(right) => (
                          <TableCell>
                            <Checkbox
                              checked={
                                roleRights()[role.roleId] >= (right as number)
                              }
                              disabled
                              onChange={() => { }}
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
        </div>
      ),
    }
  ]);

  const handleSave = async () => {
    if (!name().trim()) return;

    if (name() !== props.channel.channelName) {
      const updateResult = await fetchApi(`/channel/${props.channel.channelId}`, {
        method: 'PUT',
        body: { name: name().trim() }
      });

      if (updateResult.isErr()) {
        addToast(
          `Failed to update channel: ${updateResult.error.reason}`,
          "error"
        );
        return;
      }
    }
    modalDomain.open({ type: "close", id: 0 });
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the channel "${name()}"?`)) {
      return;
    }
    const result = await fetchApi(`/channel/${props.channel.channelId}`, {
      method: 'DELETE'
    });

    if (result.isErr()) {
      addToast(`Failed to delete channel: ${result.error.reason}`, "error");
      return;
    }

    modalDomain.open({ type: "close", id: 0 });
  };

  return (
    <div class="fixed inset-0 bg-black text-foreground bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold mb-6 flex items-center">
            {props.channel.channelType === ChannelType.Text ? (
              <Hash class="w-6 h-6 mr-2" />
            ) : (
              <Volume2 class="w-6 h-6 mr-2" />
            )}
            {props.channel.channelType} Channel Settings
          </h2>

          <Button onClick={() => { modalDomain.open({ type: "close", id: 0 }) }} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-between items-center">
          <Button
            onClick={handleDelete}
            variant="destructive"
          >
            Delete Channel
          </Button>
          <div class="flex space-x-2">
            <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="secondary">
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

export default ChannelSettingsModal;
