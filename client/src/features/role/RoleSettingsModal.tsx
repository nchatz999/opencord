import type { Component } from 'solid-js'
import { createSignal, createMemo, For } from 'solid-js'
import { Search, X, Shield } from 'lucide-solid'
import { RIGHTS, type Role } from '../../model'
import { useAcl, useGroup, useModal, useUser, useRole } from '../../store/index'
import { useToaster } from '../../components/Toaster'
import { useConfirm } from '../../components/ConfirmDialog'
import { Input } from '../../components/Input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/Table'
import Checkbox from '../../components/CheckBox'
import Button from '../../components/Button'
import { Tabs } from '../../components/Tabs'

interface RoleSettingsModalProps {
  role: Role
}

export const RoleSettingsModal: Component<RoleSettingsModalProps> = (props) => {
  const [, aclActions] = useAcl()
  const [, groupActions] = useGroup()
  const [, modalActions] = useModal()
  const [, userActions] = useUser()
  const [, roleActions] = useRole()
  const { addToast } = useToaster()
  const confirm = useConfirm()

  const [searchTerm, setSearchTerm] = createSignal('')
  const [roleName, setRoleName] = createSignal(props.role.roleName)

  const [groupRights, _] = createSignal<Record<number, number>>(
    Object.fromEntries(
      groupActions.list().map((group) => [
        group.groupId,
        aclActions.getGroupRights(group.groupId, props.role.roleId) ?? 0,
      ])
    )
  )

  const filteredUsers = createMemo(() =>
    userActions.list()
      .filter((user) => user.roleId === props.role.roleId)
      .filter((user) =>
        user.username.toLowerCase().includes(searchTerm().toLowerCase())
      )
  )

  const tabItems = createMemo(() => [
    {
      id: 'general',
      label: 'General',
      content: (
        <div class="space-y-4 mt-6">
          <Input label="Role Name" value={roleName()} onChange={setRoleName} />
        </div>
      ),
    },
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
          <div>
            <h3 class="text-lg font-semibold mb-2">Role Users</h3>
            <ul class="space-y-2 max-h-96 overflow-y-auto">
              <For each={filteredUsers()}>
                {(user) => (
                  <li class="flex items-center justify-between bg-muted p-2 rounded">
                    <div class="flex items-center space-x-2">
                      <img
                        src={`/user/${user.avatarFileId}/avatar`}
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
      ),
    },
    {
      id: 'groupPermissions',
      label: 'Permissions',
      content: (
        <div class="h-full overflow-hidden flex flex-col h-96 mt-6">
          <div class="flex-grow overflow-auto">
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
                <For each={groupActions.list()}>
                  {(group) => (
                    <TableRow>
                      <TableCell>{group.groupName}</TableCell>

                      <For each={Object.values(RIGHTS)}>
                        {(right) => (
                          <TableCell>
                            <Checkbox
                              disabled={true}
                              checked={
                                groupRights()[group.groupId] >= (right as number)
                              }
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
    },
  ])

  const handleSave = async () => {
    if (!roleName().trim()) return

    if (roleName() !== props.role.roleName) {
      const result = await roleActions.rename(props.role.roleId, roleName().trim())
      if (result.isErr()) {
        addToast(`Failed to rename role: ${result.error}`, 'error')
        return
      }
    }
    modalActions.close()
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete Role",
      message: `Are you sure you want to delete the role "${props.role.roleName}"?`,
      confirmText: "Delete",
      variant: "danger",
    })
    if (!confirmed) return

    const result = await roleActions.delete(props.role.roleId)

    if (result.isErr()) {
      addToast(`Failed to delete role: ${result.error}`, 'error')
      return
    }

    modalActions.close()
  }

  return (
    <div class="fixed inset-0 bg-black text-foreground bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold mb-6 flex items-center">
            <Shield class="w-6 h-6 mr-2" />
            Role Settings
          </h2>

          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />

        <div class="mt-6 flex justify-between items-center">
          <Button
            onClick={handleDelete}
            variant="destructive"
          >
            Delete Role
          </Button>
          <div class="flex space-x-2">
            <Button onClick={() => modalActions.close()} variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={!roleName().trim()}
              onClick={handleSave}
              variant="primary"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
