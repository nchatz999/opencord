import type { Component } from 'solid-js'
import { createSignal, createMemo, For, createEffect } from 'solid-js'
import { Hash, Volume2, X } from 'lucide-solid'
import { useToaster } from '../components/Toaster'
import { ChannelType, RIGHTS } from '../model'
import { aclDomain, groupDomain, modalDomain, roleDomain } from '../store'
import Select from '../components/Select'
import { Input } from '../components/Input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/Table'
import Checkbox from '../components/CheckBox'
import Button from '../components/Button'
import { Tabs } from '../components/Tabs'
import { fetchApi } from '../utils'





const CreateChannelModal: Component = () => {
  const { addToast } = useToaster()

  const [isCreating, setIsCreating] = createSignal(false)
  const [name, setName] = createSignal('')
  const [group, setGroup] = createSignal<number>(1)
  const [type, setType] = createSignal<ChannelType>(ChannelType.Text)

  const [roleRights, setRoleRights] = createSignal<Record<number, number>>({})

  createEffect(() => {
    setRoleRights(Object.fromEntries(
      roleDomain.list()
        .filter((role) => role.roleId > 1)
        .map((role) => [role.roleId,
        aclDomain.getGroupRights(group(), role.roleId) || 0,
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
            options={groupDomain.list().map((group) => ({ value: group.groupId, label: group.groupName }))}
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
              <For each={roleDomain.list().filter((role) => role.roleId > 1)}>
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

    setIsCreating(true)
    if (!group()) {
      addToast('No group selected', 'error')
      return
    }

    const createResult = await fetchApi('/channel', {
      method: 'POST',
      body: {
        name: name().trim(),
        groupId: group(),
        type: type(),
      },
    })

    if (createResult.isErr()) {
      addToast(
        `Failed to create channel: ${createResult.error.reason}`,
        'error'
      )
      return
    }

    modalDomain.open({ type: "close", id: 0 })
  }

  return (
    <div class="fixed inset-0 text-[#dcddde] bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-[#36393f] rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold mb-6 flex items-center">
            {type() === ChannelType.Text ? (
              <Hash class="w-6 h-6 mr-2" />
            ) : (
              <Volume2 class="w-6 h-6 mr-2" />
            )}
            Create New Channel
          </h2>
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>

        <Tabs items={tabItems()} />

        <div class="mt-6 flex justify-end space-x-2">
          <Button onClick={() => modalDomain.open({ type: "close", id: 0 })} variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={isCreating() || !name().trim()}
            onClick={handleCreate}
            variant="primary"
          >
            {isCreating() ? 'Creating...' : 'Create Channel'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CreateChannelModal
