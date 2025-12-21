import type { Component } from 'solid-js'
import { createSignal, createMemo, For, createEffect } from 'solid-js'
import { Hash, Volume2, X } from 'lucide-solid'
import { useToaster } from '../../components/Toaster'
import { ChannelType, RIGHTS } from '../../model'
import { useAcl, useGroup, useModal, useRole, useChannel } from '../../store/index'
import Select from '../../components/Select'
import { Input } from '../../components/Input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/Table'
import Checkbox from '../../components/CheckBox'
import Button from '../../components/Button'
import { Tabs } from '../../components/Tabs'





const CreateChannelModal: Component = () => {
  const { addToast } = useToaster()
  const [, aclActions] = useAcl()
  const [, groupActions] = useGroup()
  const [, modalActions] = useModal()
  const [, roleActions] = useRole()
  const [, channelActions] = useChannel()

  const [name, setName] = createSignal('')
  const [group, setGroup] = createSignal<number | null>(null)
  const [type, setType] = createSignal<ChannelType>(ChannelType.Text)

  const [roleRights, setRoleRights] = createSignal<Record<number, number>>({})

  createEffect(() => {
    const groupId = group()
    if (groupId === null) {
      setRoleRights({})
      return
    }
    setRoleRights(Object.fromEntries(
      roleActions.list()
        .filter((role) => role.roleId > 2)
        .map((role) => [role.roleId,
        aclActions.getGroupRights(groupId, role.roleId) || 0,
        ])
    ))
  })

  const tabItems = createMemo(() => [
    {
      id: 'settings',
      label: 'Channel Settings',
      content: (
        <div class="space-y-4 mt-6">
          <Input label="Channel Name" value={name()} onChange={setName} />
          <Select
            options={[
              { value: ChannelType.Text, label: 'Text Channel' },
              {
                value: ChannelType.VoIP,
                label: 'Voice Channel',
              },
            ]}
            value={type()}
            onChange={(value) => setType(value as ChannelType)}
          />
        </div>
      ),
    },
    {
      id: 'rights',
      label: 'Rights',
      content: (
        <div class="space-y-4 mt-6">
          <div class="flex justify-between items-center">
            <h3 class="text-lg font-semibold">Role Permissions</h3>
          </div>
          <Select
            options={groupActions.list().map((group) => ({ value: group.groupId, label: group.groupName }))}
            value={group()}
            onChange={(value) => setGroup(value as number)}
          />

          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Role</TableHeader>
                <For each={Object.keys(RIGHTS)}>
                  {(right) => <TableHeader>{right}</TableHeader>}
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
                            checked={roleRights()[role.roleId] >= right}
                            disabled={true}
                            onChange={(_checked) => {
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

  const handleCreate = async () => {
    if (!name().trim()) return

    const groupId = group()
    if (!groupId) {
      addToast('No group selected', 'error')
      return
    }

    const createResult = await channelActions.create(groupId, name().trim(), type())

    if (createResult.isErr()) {
      addToast(`Failed to create channel: ${createResult.error}`, 'error')
      return
    }

    modalActions.close()
  }

  return (
    <div class="fixed inset-0 text-foreground bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold mb-6 flex items-center">
            {type() === ChannelType.Text ? (
              <Hash class="w-6 h-6 mr-2" />
            ) : (
              <Volume2 class="w-6 h-6 mr-2" />
            )}
            Create New Channel
          </h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />

        <div class="mt-6 flex justify-end space-x-2">
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
  )
}

export default CreateChannelModal
