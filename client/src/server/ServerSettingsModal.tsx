import type { Component } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { Search, Trash2, X, Plus, Copy, Users } from 'lucide-solid'
import { useToaster } from '../components/Toaster'
import Button from '../components/Button'
import { Tabs } from '../components/Tabs'
import { modalDomain, roleDomain, userDomain } from '../store'
import { Input } from '../components/Input'
import Select from '../components/Select'
import Checkbox from '../components/CheckBox'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/Table'
import { fetchApi } from '../utils'
import { match } from 'opencord-utils'
import type { User } from '../model'


interface Invite {
  inviteId: number;
  code: string;
  availableRegistrations: number;
  roleId: number;
  createdAt: string;
}

const ServerSettingsModal: Component = () => {
  const [serverName, setServerName] = createSignal('Awesome Discord Server')
  const [maxFileSize, setMaxFileSize] = createSignal('50')
  const [isRegistrationOpen, setIsRegistrationOpen] = createSignal(true)
  const [searchTerm, setSearchTerm] = createSignal('')


  const [invites, setInvites] = createSignal<Invite[]>([])
  const [newInviteCode, setNewInviteCode] = createSignal('')
  const [newInviteRegistrations, setNewInviteRegistrations] = createSignal('1')
  const [newInviteRoleId, setNewInviteRoleId] = createSignal('2')
  const [loading, setLoading] = createSignal(false)

  const { addToast } = useToaster()

  const serverVersion = '1.2.3'
  const clientVersion = '2.0.1'



  const filteredUsers = createMemo(() =>
    userDomain.getAllUsers().filter((user: User) =>
      user.username.toLowerCase().includes(searchTerm().toLowerCase())
    )
  )


  const canManageInvites = () => {
    const user = userDomain.getCurrentUser();
    return user && (user.roleId === 0 || user.roleId === 1);
  };

  const loadInvites = async () => {
    if (!canManageInvites()) return;

    setLoading(true);
    try {
      const result = await fetchApi<Invite[]>("/auth/invites", {
        method: "GET",
      });

      if (result.ok) {
        setInvites(result.value)
      }
    } catch (error) {
      console.error("Error loading invites:", error);
      addToast("Error loading invites", "error");
    } finally {
      setLoading(false);
    }
  };

  const createInvite = async () => {
    if (!newInviteCode().trim()) {
      addToast("Please enter an invite code", "error");
      return;
    }

    const registrations = parseInt(newInviteRegistrations());
    if (isNaN(registrations) || registrations < 1) {
      addToast("Please enter a valid number of registrations", "error");
      return;
    }

    setLoading(true);
    try {
      const result = await fetchApi<Invite>("/auth/invites", {
        method: "POST",
        body: {
          code: newInviteCode(),
          available_registrations: registrations,
          role_id: parseInt(newInviteRoleId()),
        },
      });

      match(result, {
        ok: (invite) => {
          setInvites([invite, ...invites()]);
          setNewInviteCode("");
          setNewInviteRegistrations("1");
          setNewInviteRoleId("2");
          addToast("Invite created successfully", "success");
        },
        err: (error) => {
          const message = (error as any)?.reason || "Failed to create invite";
          addToast(message, "error");
        },
      });
    } catch (error) {
      console.error("Error creating invite:", error);
      addToast("Error creating invite", "error");
    } finally {
      setLoading(false);
    }
  };

  const deleteInvite = async (inviteId: number) => {
    setLoading(true);
    try {
      const result = await fetchApi("/auth/invites", {
        method: "DELETE",
        body: { invite_id: inviteId },
      });

      match(result, {
        ok: () => {
          setInvites(invites().filter(invite => invite.inviteId !== inviteId));
          addToast("Invite deleted successfully", "success");
        },
        err: (error) => {
          const message = (error as any)?.reason || "Failed to delete invite";
          addToast(message, "error");
        },
      });
    } catch (error) {
      console.error("Error deleting invite:", error);
      addToast("Error deleting invite", "error");
    } finally {
      setLoading(false);
    }
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      addToast("Invite code copied to clipboard", "success");
    }).catch(() => {
      addToast("Failed to copy invite code", "error");
    });
  };


  const tabItems = createMemo(() => [
    {
      id: 'general',
      label: 'General',
      content: (
        <div class="space-y-4 mt-6">
          <Input
            label="Server Name"
            value={serverName()}
            onChange={setServerName}
            placeholder="Enter server name"
          />
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">
              Maximum File Size (MB)
            </label>
            <Select
              value={maxFileSize()}
              onChange={setMaxFileSize}
              options={[
                { value: '8', label: '8 MB' },
                { value: '50', label: '50 MB' },
                { value: '100', label: '100 MB' },
              ]}
            />
          </div>

          {}
          <div class="mt-6 pt-4 border-t border-gray-700">
            <h3 class="text-lg font-semibold mb-2">Version Information</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1">
                  Server Version
                </label>
                <p class="text-sm text-gray-400">{serverVersion}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1">
                  Client Version
                </label>
                <p class="text-sm text-gray-400">{clientVersion}</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'rights',
      label: 'Rights',
      content: (
        <div class="space-y-4 mt-6">
          <div class="space-y-4">
            <Input
              value={searchTerm()}
              onChange={setSearchTerm}
              placeholder="Search users..."
              icon={<Search class="w-4 h-4 text-gray-400" />}
            />
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>User</TableHeader>
                  <TableHeader>Role</TableHeader>
                  <TableHeader class="text-right">Actions</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <For each={filteredUsers()}>
                  {(user) => (
                    <TableRow class="hover:bg-[#383a40]">
                      <TableCell>
                        <div class="flex items-center space-x-3">
                          <img
                            src={`/api/user/${user.avatarFileId}/avatar`}
                            alt={user.username}
                            class="w-8 h-8 rounded-full"
                          />
                          <span class="font-medium">{user.username}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.roleId}
                          onChange={async (roleId) => {
                            console.log(roleId)
                            const result = await fetchApi(`/user/${user.userId}/role`, {
                              method: "PUT",
                              body: {
                                roleId: roleId,
                              }
                            });
                            if (result.error) {
                              addToast(result.error.reason, "error")
                            }
                          }}
                          options={roleDomain.getAllRoles().map((role) => ({
                            value: role.roleId,
                            label: role.roleName,
                          }))}
                          class="min-w-[120px]"
                        />
                      </TableCell>
                      <TableCell class="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={user.roleId === 0}
                          title={user.roleId === 0 ? "Cannot delete owner" : "Delete user"}
                        >
                          <Trash2 class="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                </For>
              </TableBody>
            </Table>
          </div>
        </div>
      ),
    },
    {
      id: 'authentication',
      label: 'Authentication',
      content: (
        <div class="space-y-4 mt-6">
          <Checkbox
            checked={isRegistrationOpen()}
            onChange={setIsRegistrationOpen}
            label="Allow Open Registration"
          />
          <Show when={isRegistrationOpen()}>
            <div class="bg-yellow-500/20 border border-yellow-500/30 text-yellow-200 p-4 rounded-lg">
              <p class="text-sm">
                <strong>Warning:</strong> Open registration may lead to unwanted users joining
                your server. Consider using invite links or manual approvals for
                better control.
              </p>
            </div>
          </Show>
        </div>
      ),
    },
    {
      id: 'invitations',
      label: 'Invitations',
      content: (
        <Show
          when={canManageInvites()}
          fallback={
            <div class="text-center py-8 text-[#72767d]">
              You don't have permission to manage invitations.
            </div>
          }
        >
          <div class="space-y-6 mt-6">
            <div class="flex items-center gap-2 mb-4">
              <Users class="w-5 h-5 text-[#dcddde]" />
              <h3 class="text-lg font-semibold text-[#dcddde]">Invitation Management</h3>
            </div>

            {}
            <div class="bg-[#2f3136] rounded-lg p-4">
              <h4 class="text-md font-medium text-[#dcddde] mb-4">Create New Invitation</h4>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div class="md:col-span-1">
                  <Input
                    label="Invite Code"
                    value={newInviteCode()}
                    onChange={setNewInviteCode}
                    placeholder="Enter unique invite code"
                    disabled={loading()}
                  />
                </div>
                <div>
                  <Input
                    label="Available Uses"
                    type="number"
                    value={newInviteRegistrations()}
                    onChange={setNewInviteRegistrations}
                    placeholder="1"
                    min="1"
                    disabled={loading()}
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-1">
                    Role
                  </label>
                  <Select
                    value={newInviteRoleId()}
                    onChange={setNewInviteRoleId}
                    options={roleDomain.getAllRoles().filter((role) => role.roleId != 0).map((role) => ({
                      value: role.roleId.toString(),
                      label: role.roleName,
                    }))}
                  />
                </div>
              </div>
              <div class="mt-4">
                <Button
                  onClick={createInvite}
                  disabled={loading()}
                  class="flex items-center gap-2"
                >
                  <Plus class="w-4 h-4" />
                  Create Invite
                </Button>
              </div>
            </div>

            {}
            <div class="bg-[#2f3136] rounded-lg p-4">
              <div class="flex items-center justify-between mb-4">
                <h4 class="text-md font-medium text-[#dcddde]">Active Invitations</h4>
                <Button
                  onClick={loadInvites}
                  variant="secondary"
                  size="sm"
                  disabled={loading()}
                >
                  Refresh
                </Button>
              </div>
              <Show
                when={invites().length > 0}
                fallback={
                  <div class="text-center py-8 text-[#72767d]">
                    No invitations found. Create one to get started.
                  </div>
                }
              >
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader class="text-center">Code</TableHeader>
                      <TableHeader class="text-center">Uses Left</TableHeader>
                      <TableHeader class="text-center">Role</TableHeader>
                      <TableHeader class="text-center">Actions</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <For each={invites()}>
                      {(invite) => (
                        <TableRow class="hover:bg-[#383a40]">
                          <TableCell style={{ width: "200px" }}>
                            <div class="flex items-center gap-2">
                              <code class="bg-[#202225] px-2 py-1 rounded font-mono text-sm">
                                {invite.code}
                              </code>
                              <Button
                                onClick={() => copyInviteCode(invite.code)}
                                variant='ghost'
                                title="Copy invite code"
                              >
                                <Copy class="w-4 h-4 text-[#b9bbbe]" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell class="text-center">
                            <span class={`px-2 py-1 rounded text-xs font-medium ${invite.availableRegistrations > 0
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                              }`}>
                              {invite.availableRegistrations}
                            </span>
                          </TableCell>
                          <TableCell class="text-center">
                            <span class="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                              {roleDomain.getRoleById(invite.roleId)?.roleName || 'Unknown'}
                            </span>
                          </TableCell>
                          <TableCell class="text-center">
                            <Button
                              onClick={() => deleteInvite(invite.inviteId)}
                              variant='destructive'
                              disabled={loading()}
                              title="Delete invite"
                            >
                              <Trash2 class="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )}
                    </For>
                  </TableBody>
                </Table>
              </Show>
            </div>
          </div>
        </Show>
      ),
    },
  ])



  const handleModalOpen = () => {
    if (canManageInvites()) {
      loadInvites();
    }
  };


  setTimeout(() => handleModalOpen(), 100);

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-[#36393f] text-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">Server Settings</h2>
          <Button onClick={() => modalDomain.setModal({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-end space-x-2">
          <Button onClick={() => modalDomain.setModal({ type: "close", id: 0 })} variant="secondary">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ServerSettingsModal
