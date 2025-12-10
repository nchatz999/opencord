import type { Component } from 'solid-js'
import { createSignal, createMemo, For } from 'solid-js'
import { Hash, Volume2, X } from 'lucide-solid'
import { RIGHTS, type Group } from '../model'
import { useToaster } from '../components/Toaster'
import { aclDomain, groupDomain, modalDomain, roleDomain, userDomain } from '../store'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table'
import Checkbox from '../components/CheckBox'
import { Tabs } from '../components/Tabs'
import { Input } from '../components/Input'
import Button from '../components/Button'
import { fetchApi } from '../utils'

interface GroupSettingsProps {
  group: Group
}

const GroupSettingsModal: Component<GroupSettingsProps> = (props) => {
  const { addToast } = useToaster()
  const user = userDomain.getCurrent()

  const [name, setName] = createSignal(props.group.groupName)
  const [isDeleting, setIsDeleting] = createSignal(false)

  const [roleRights, setRoleRights] = createSignal<Record<number, number>>(
    Object.fromEntries(
      roleDomain.list()
        .filter((role) => role.roleId > 1)
        .map((role) => [
          role.roleId,
          aclDomain.getGroupRights(props.group.groupId, role.roleId) ?? 0,
        ])
    )
  )

  const tabItems = createMemo(() => [
    {
      id: 'channels',
      label: 'Channels',
      content: (
        <div class="flex flex-col h-96 mt-6">
          <div class="flex-grow overflow-y-auto mb-4 pr-2 custom-scrollbar">
            <ul class="space-y-2">
              <For each={groupDomain.getChannels(props.group.groupId)}>
                {(channel) => (
                  <li class="flex items-center justify-between bg-card p-2 rounded">
                    <div class="flex items-center">
                      {channel.channelType === 'Text' ? (
                        <Hash class="w-4 h-4 mr-2" />
                      ) : (
                        <Volume2 class="w-4 h-4 mr-2" />
                      )}
                      <span>{channel.channelName}</span>
                    </div>
                    <button class="text-tab-inactive hover:text-primary-foreground">
                      <X class="w-4 h-4" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
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
                              disabled={

                                roleRights()[user.roleId] < 16 ||

                                (user.roleId > 1 &&
                                  (roleRights()[user.roleId] <=
                                    roleRights()[role.roleId] ||
                                    roleRights()[user.roleId] <=
                                    (right as number)))
                              }
                              onChange={(checked) => {
                                setRoleRights((prev) => {
                                  return {
                                    ...prev,
                                    [role.roleId]: checked
                                      ? (right as number)
                                      : (right as number) >> 1,
                                  }
                                })
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
  ])

  const handleSave = async () => {

    const groupRightsPayload = Array.from(Object.entries(roleRights())).map(
      ([roleId, right]) => ({
        groupId: props.group.groupId,
        roleId: Number(roleId),
        rights: right,
      })
    )

    if (groupRightsPayload.length > 0) {
      const aclResult = await fetchApi<void>('/acl/group-role-rights', {
        method: 'PUT',
        body: groupRightsPayload
      })

      if (aclResult.isErr()) {
        addToast(`Failed to update group permissions: ${aclResult.error.reason}`, 'error')
        return
      }
    }

    addToast('Group settings saved successfully', 'success')
    modalDomain.open({ type: "close", id: 0 })
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the group "${name()}"?`)) {
      return
    }

    const result = await fetchApi<void>(`/group/${props.group.groupId}`, {
      method: 'DELETE'
    })

    if (result.isErr()) {
      addToast(`Failed to delete group: ${result.error.reason}`, 'error')
      setIsDeleting(false)
      return
    }

    modalDomain.open({ type: "close", id: 0 })
  }

  return (
    <div class="fixed inset-0 text-foreground bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Group Settings</h2>
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Input
          value={props.group.groupName}
          placeholder="Group Name"
          onChange={(value) => setName(value)}
          class="mb-6"
        />
        <Tabs items={tabItems()} class="flex-grow" />
        <div class="mt-6 flex justify-between items-center">
          <Button
            onClick={handleDelete}
            disabled={isDeleting()}
            variant="destructive"
          >
            {isDeleting() ? "Deleting..." : "Delete Group"}
          </Button>
          <div class="flex space-x-2">
            <Button variant="secondary" onClick={() => modalDomain.open({ type: "close", id: 0 })}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GroupSettingsModal
