import type { Component } from "solid-js";
import { createSignal, createMemo, For } from "solid-js";
import { Hash, Plus, Volume2, X } from "lucide-solid";
import { ChannelType, RIGHTS } from "../model";
import { modalDomain, roleDomain } from "../store";
import { Input } from "../components/Input";
import Select from "../components/Select";
import Button from "../components/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/Table";
import Checkbox from "../components/CheckBox";
import { Tabs } from "../components/Tabs";
import { fetchApi } from "../utils";

const CreateGroupModal: Component = () => {
  const [isLoading, setIsLoading] = createSignal(false);
  const [name, setName] = createSignal<string>("");
  const [newChannelTitle, setNewChannelTitle] = createSignal("");
  const [newChannelType, setNewChannelType] = createSignal(ChannelType.Text);
  const [roleRights, setRoleRights] = createSignal<Record<number, number>>(
    Object.fromEntries(
      roleDomain.list()
        .filter((role) => role.roleId > 1)
        .map((role) => [role.roleId, [0, 1].includes(role.roleId) ? 16 : 0])
    )
  );
  const [groupChannels, setGroupChannels] = createSignal<
    {
      name: string;
      type: ChannelType;
    }[]
  >([]);

  const addChannel = () => {
    if (!newChannelTitle().trim()) return;
    setGroupChannels((prev) => [
      ...prev,
      { name: newChannelTitle(), type: newChannelType() },
    ]);
    setNewChannelTitle("");
  };

  const removeChannel = (channelName: string) => {
    setGroupChannels((prev) => prev.filter((c) => c.name !== channelName));
  };

  const handleSave = async () => {
    if (!name().trim()) {
      alert("Please enter a group name");
      return;
    }

    setIsLoading(true);
    try {

      const createResult = await fetchApi('/group', {
        method: 'POST',
        body: { name: name().trim() }
      });

      if (createResult.isErr()) {
        alert(`Error creating group: ${createResult.error.reason}`);
        return;
      }

      const groupId = createResult.value.groupId;


      const aclResult = await fetchApi('/acl/group-role-rights', {
        method: 'PUT',
        body:
          Array.from(Object.entries(roleRights())).map(
            ([roleId, right]) => ({
              groupId,
              roleId: Number(roleId),
              rights: right,
            })
          ),

      });

      if (aclResult.isErr()) {
        alert(`Failed to set group permissions: ${aclResult.error.reason}`);

      }


      for (const channel of groupChannels()) {
        const channelResult = await fetchApi('/channel', {
          method: 'POST',
          body: {
            name: channel.name,
            channel_id: groupId,
            type: channel.type,
          },
        });

        if (channelResult.isErr()) {
          console.error(`Failed to create channel ${channel.name}:`, channelResult.error.reason);
        }
      }


      modalDomain.open({ type: "close", id: 0 })

    } catch (error) {
      alert("Failed to create group");
    } finally {
      setIsLoading(false);
    }
  };

  const tabItems = createMemo(() => [
    {
      id: "channels",
      label: "Channels",
      content: (
        <div class="flex flex-col h-96 mt-6">
          <div class="flex-grow overflow-y-auto mb-4 pr-2 custom-scrollbar">
            <ul class="space-y-2">
              <For each={groupChannels()}>
                {(channel) => (
                  <li class="flex items-center justify-between bg-[#2f3136] p-2 rounded">
                    <div class="flex items-center">
                      {channel.type === ChannelType.Text ? (
                        <Hash class="w-4 h-4 mr-2" />
                      ) : (
                        <Volume2 class="w-4 h-4 mr-2" />
                      )}
                      <span>{channel.name}</span>
                    </div>
                    <button
                      onClick={() => removeChannel(channel.name)}
                      class="text-[#8e9297] hover:text-white"
                    >
                      <X class="w-4 h-4" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div class="flex space-x-2 mb-2">
            <Input
              value={newChannelTitle()}
              placeholder="New channel name"
              onChange={setNewChannelTitle}
            />
            <Select
              options={[
                { value: ChannelType.Text, label: "Text" },
                { value: ChannelType.VoIP, label: "VoIP" },
              ]}
              value={newChannelType()}
              onChange={(value) => setNewChannelType(value as ChannelType)}
            />
            <Button onClick={addChannel}>
              <Plus class="w-4 h-4" />
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "permissions",
      label: "Permissions",
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
                              disabled={role.roleId === 0 || role.roleId === 1}
                              checked={
                                roleRights()[role.roleId] >= (right as number)
                              }
                              onChange={(checked) => {
                                setRoleRights((prev) => {
                                  return {
                                    ...prev,
                                    [role.roleId]: checked
                                      ? (right as number)
                                      : (right as number) >> 1,
                                  };
                                });
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
        </div>
      ),
    },
  ]);

  return (
    <div class="fixed inset-0 text-[#dcddde] bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-[#36393f] rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Group Creation</h2>
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Input
          value={name()}
          placeholder="Group Name"
          onChange={setName}
          class="mb-6"
        />
        <Tabs items={tabItems()} class="flex-grow" />
        <div class="mt-6 flex justify-end space-x-2">
          <Button variant="secondary" onClick={() => modalDomain.open({ type: "close", id: 0 })}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading()}>
            {isLoading() ? "Creating..." : "Create Group"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateGroupModal;
