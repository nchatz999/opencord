import type { Component } from 'solid-js'
import { createSignal, createMemo, For } from 'solid-js'
import { X } from 'lucide-solid'
import { useToaster } from '../components/Toaster';
import { Input } from '../components/Input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table';
import { RIGHTS } from '../model';
import { groupDomain, modalDomain } from '../store';
import Checkbox from '../components/CheckBox';
import Button from '../components/Button';
import { Tabs } from '../components/Tabs';
import { fetchApi } from '../utils';


interface CreateRoleResponse {
  roleId: number;
}

const CreateRoleModal: Component = () => {

  const [roleName, setRoleName] = createSignal('')
  const [groupRights, setGroupRights] = createSignal<Record<number, number>>({})
  const { addToast } = useToaster()

  const tabItems = createMemo(() => [
    {
      id: 'groupPermissions',
      label: 'Group Permissions',
      content: (
        <div class="space-y-4 mt-6">
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">Group Permissions</h3>
          </div>
          <Input
            label="Role Name"
            value={roleName()}
            onChange={setRoleName}
            placeholder="Role Name"
          />
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>group</TableHeader>
                <For each={Object.keys(RIGHTS)}>
                  {(right) => <TableHeader>{right}</TableHeader>}
                </For>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={groupDomain.list()}>
                {(group) => (
                  <TableRow>
                    <TableCell>{group.groupName}</TableCell>

                    <For each={Object.values(RIGHTS)}>
                      {(right) => (
                        <TableCell>
                          <Checkbox
                            checked={
                              groupRights()[group.groupId] >= (right as number)
                            }
                            onChange={(checked) => {
                              setGroupRights((prev) => {
                                return {
                                  ...prev,
                                  [group.groupId]: checked
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
      ),
    },
  ])
  const handleSave = async () => {
    if (!roleName().trim()) return

    let result = await fetchApi<CreateRoleResponse>('/role', {
      method: 'POST',
      body: { name: roleName() }
    })

    if (result.isErr()) {
      addToast(`Failed to create role: ${result.error.reason}`, 'error')
      return
    }
    let roleId = result.value.roleId


    const groupRightsPayload = Array.from(Object.entries(groupRights())).map(
      ([groupId, right]) => ({
        groupId: Number(groupId),
        roleId: Number(roleId),
        rights: right,
      })
    )

    if (groupRightsPayload.length > 0) {
      const aclGroupResult = await fetchApi<void>('/acl/group-role-rights', {
        method: 'PUT',
        body: groupRightsPayload
      })

      if (aclGroupResult.isErr()) {
        addToast(`Failed to update group permissions: ${aclGroupResult.error.reason}`, 'error')
        return
      }
    }

    addToast(`Role "${roleName().trim()}" created successfully!`, 'success')

    modalDomain.open({ type: "close", id: 0 })
  }
  return (
    <div class="fixed inset-0 bg-black text-foreground bg-opacity-50 flex items-center justify-center">
      <div class="bg-popover rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Create Role</h2>
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-end space-x-2">
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="secondary">
            Cancel
          </Button>
          <Button onClick={handleSave}> Save Changes</Button>
        </div>
      </div>
    </div>
  )
}

export default CreateRoleModal
