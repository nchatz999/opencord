import type { Component } from 'solid-js'
import { createSignal, createMemo, For } from 'solid-js'
import { Search, X } from 'lucide-solid'
import { RIGHTS, type Role } from '../model'
import { aclDomain, groupDomain, modalDomain, userDomain } from '../store'
import { useToaster } from '../components/Toaster'
import { Input } from '../components/Input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table'
import Checkbox from '../components/CheckBox'
import Button from '../components/Button'
import { Tabs } from '../components/Tabs'
import { fetchApi } from '../utils'

interface RoleSettingsModalProps {
  role: Role
}

export const RoleSettingsModal: Component<RoleSettingsModalProps> = (props) => {
  const user = userDomain.getCurrent()

  if (!user) {
    return null
  }
  const { addToast } = useToaster()

  const [searchTerm, setSearchTerm] = createSignal('')
  const [isDeleting, setIsDeleting] = createSignal(false)

  const [groupRights, setGroupRights] = createSignal<Record<number, number>>(
    Object.fromEntries(
      groupDomain.list().map((group) => [
        group.groupId,
        aclDomain.getGroupRights(group.groupId, props.role.roleId) ?? 0,
      ])
    )
  )

  const filteredUsers = createMemo(() =>
    userDomain.list()
      .filter((user) => user.roleId === props.role.roleId)
      .filter((user) =>
        user.username.toLowerCase().includes(searchTerm().toLowerCase())
      )
  )

  const tabItems = createMemo(() => [
    {
      id: 'users',
      label: 'Users',
      content: (
        <div class="space-y-4 mt-6">
          <Input
            value={searchTerm()}
            onChange={setSearchTerm}
            placeholder="Search users..."
            icon={<Search class="w-4 h-4 text-muted-foreground-dark" />}
          />
          <div class="grid grid-cols-2 gap-4">
            <div>
              <h3 class="text-lg font-semibold mb-2">Role Users</h3>
              <ul class="space-y-2 max-h-96 overflow-y-auto">
                <For each={filteredUsers()}>
                  {(user) => (
                    <li class="flex items-center justify-between bg-muted p-2 rounded">
                      <div class="flex items-center space-x-2">
                        <img
                          src={
                            user.avatarFileId?.toString() ||
                            '/default-avatar.png'
                          }
                          alt={user.username}
                          class="w-8 h-8 rounded-full"
                        />
                        <span>{user.username}</span>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'groupPermissions',
      label: 'Group Permissions',
      content: (
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">Group Permissions</h3>
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Group</TableHeader>
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

    const groupRightsPayload = Array.from(Object.entries(groupRights())).map(
      ([groupId, right]) => ({
        groupId: Number(groupId),
        roleId: Number(props.role.roleId),
        rights: right,
      })
    )

    if (groupRightsPayload.length > 0) {
      const aclGroupResult = await fetchApi<void>('/acl/group-role-rights', {
        method: 'PUT',
        body: groupRightsPayload
      })

      if (aclGroupResult.isErr()) {
        addToast(
          `Failed to update role acl: ${aclGroupResult.error.reason}`,
          'error'
        )
        return
      }
    }

    addToast(
      `Role "${props.role.roleName.trim()}" has been updated!`,
      'success'
    )

    modalDomain.open({ type: "close", id: 0 })
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the role "${props.role.roleName}"?`)) {
      return
    }

    setIsDeleting(true)
    const result = await fetchApi<void>(`/role/${props.role.roleId}`, {
      method: 'DELETE'
    })

    if (result.isErr()) {
      addToast(`Failed to delete role: ${result.error.reason}`, 'error')
      setIsDeleting(false)
      return
    }

    addToast(`Role "${props.role.roleName}" deleted successfully!`, 'success')
    modalDomain.open({ type: "close", id: 0 })
  }

  return (
    <div class="fixed inset-0 bg-black text-foreground bg-opacity-50 flex items-center justify-center">
      <div class="bg-popover rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">
            Role Settings: {props.role.roleName}
          </h2>

          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <p class="text-sm text-muted-foreground-dark mt-1"></p>
        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-between items-center">
          <Button
            onClick={handleDelete}
            disabled={isDeleting()}
            variant="destructive"
          >
            {isDeleting() ? "Deleting..." : "Delete Role"}
          </Button>
          <div class="flex space-x-2">
            <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
