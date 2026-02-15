import type { Component } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { Search, Trash2, X, Plus, Copy, Users, FileText, RefreshCw, Upload } from 'lucide-solid'
import { useToaster } from '../../components/Toaster'
import { useConfirm } from '../../components/ConfirmDialog'
import Button from '../../components/Button'
import { Tabs } from '../../components/Tabs'
import Card from '../../components/Card'
import { useAcl, useAuth, useModal, useRole, useServer, useUser } from '../../store/index'
import { selectFile } from '../../utils'
import { Input } from '../../components/Input'
import Select from '../../components/Select'
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../../components/Table'
import { request } from '../../utils'
import type { User } from '../../model'
import Avatar from '../../components/Avatar'
import ImagePreview from '../../components/ImagePreview'


interface Invite {
    inviteId: number;
    code: string;
    availableRegistrations: number;
    roleId: number;
    createdAt: string;
}

interface LogEntry {
    id: string;
    log: string;
    date: string;
    category: string;
}

const ServerSettingsModal: Component = () => {
    const [, aclActions] = useAcl()
    const [, authActions] = useAuth()
    const [, modalActions] = useModal()
    const [, roleActions] = useRole()
    const [, serverActions] = useServer()
    const [, userActions] = useUser()
    const currentUser = () => authActions.getUser()
    const [searchTerm, setSearchTerm] = createSignal('')

    const [invites, setInvites] = createSignal<Invite[]>([])
    const [newInviteCode, setNewInviteCode] = createSignal('')
    const [newInviteRegistrations, setNewInviteRegistrations] = createSignal('1')
    const [newInviteRoleId, setNewInviteRoleId] = createSignal('2')

    const [logs, setLogs] = createSignal<LogEntry[]>([])
    const [logsLoading, setLogsLoading] = createSignal(false)
    const [logCategoryFilter, setLogCategoryFilter] = createSignal<string>('')
    const [logSearchTerm, setLogSearchTerm] = createSignal('')
    const [activeTab, setActiveTab] = createSignal("general")

    const { addToast } = useToaster()
    const confirm = useConfirm()

    const filteredUsers = createMemo(() =>
        userActions.list().filter((user: User) =>
            user.username.toLowerCase().includes(searchTerm().toLowerCase())
        )
    )

    const isAdmin = () => {
        return currentUser().roleId <= 2;
    };

    const serverConfig = () => serverActions.get();

    const saveServerName = async (name: string) => {
        if (!isAdmin()) return;
        const currentConfig = serverConfig();
        if (!currentConfig || name === currentConfig.serverName) return;

        const result = await serverActions.updateName(name);

        if (result.isErr()) {
            addToast(result.error, 'error');
        }
    };


    const loadInvites = async () => {
        if (!isAdmin()) return;

        const result = await request<Invite[]>("/auth/invites", {
            method: "GET",
        });

        if (result.isErr()) {
            addToast(result.error.reason, "error");
            return;
        }

        setInvites(result.value);
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

        const result = await request<Invite>("/auth/invites", {
            method: "POST",
            body: {
                code: newInviteCode(),
                available_registrations: registrations,
                role_id: parseInt(newInviteRoleId()),
            },
        });

        if (result.isErr()) {
            addToast(result.error.reason, "error");
            return;
        }

        setInvites([result.value, ...invites()]);
        setNewInviteCode("");
        setNewInviteRegistrations("1");
        setNewInviteRoleId("2");
        addToast("Invite created successfully", "success");
    };

    const deleteInvite = async (inviteId: number) => {
        const result = await request("/auth/invites", {
            method: "DELETE",
            body: { invite_id: inviteId },
        });

        if (result.isErr()) {
            addToast(result.error.reason, "error");
            return;
        }

        setInvites(invites().filter(invite => invite.inviteId !== inviteId));
        addToast("Invite deleted successfully", "success");
    };

    const copyInviteCode = (code: string) => {
        navigator.clipboard.writeText(code).then(() => {
            addToast("Invite code copied to clipboard", "success");
        }).catch(() => {
            addToast("Failed to copy invite code", "error");
        });
    };

    const loadLogs = async () => {
        if (!isAdmin()) return;

        setLogsLoading(true);
        const result = await request<LogEntry[]>("/log", {
            method: "GET",
        });

        if (result.isErr()) {
            addToast(result.error.reason, "error");
            setLogsLoading(false);
            return;
        }

        setLogs(result.value);
        setLogsLoading(false);
    };

    const deleteLogs = async (category?: string) => {
        if (!isAdmin()) return;

        setLogsLoading(true);
        const result = await request<{ deletedCount: number }>("/log", {
            method: "DELETE",
            query: category ? { category } : undefined,
        });

        if (result.isErr()) {
            addToast(result.error.reason, "error");
            setLogsLoading(false);
            return;
        }

        addToast(`Deleted ${result.value.deletedCount} log entries`, "success");
        loadLogs();
        setLogsLoading(false);
    };

    const filteredLogs = createMemo(() => {
        const search = logSearchTerm().toLowerCase();
        const category = logCategoryFilter();
        return logs().filter((log) => {
            if (category && log.category !== category) return false;
            if (search && !log.log.toLowerCase().includes(search) && !log.category.toLowerCase().includes(search)) return false;
            return true;
        });
    });

    const logCategories = createMemo(() => {
        const categories = new Set(logs().map((log) => log.category));
        return Array.from(categories).sort();
    });

    const formatLogDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    const tabItems = createMemo(() => [
        {
            id: 'general',
            label: 'General',
            content: (
                <div class="space-y-4 mt-6">
                    <Show when={serverConfig()}>
                        {(config) => (
                            <Card>
                                <div class="flex items-center gap-4">
                                    <div class="relative">
                                        <Show
                                            when={config().avatarFileId}
                                            fallback={
                                                <div class="w-20 h-20 rounded-full bg-accent-primary flex items-center justify-center text-2xl font-bold">
                                                    {config().serverName.charAt(0)}
                                                </div>
                                            }
                                        >
                                            {(avatarId) => (
                                                <ImagePreview
                                                    src={`/server/avatar/${avatarId()}`}
                                                    alt="Server avatar"
                                                    class="w-20 h-20 rounded-full object-cover"
                                                />
                                            )}
                                        </Show>
                                        <Show when={isAdmin()}>
                                            <Button
                                                onClick={async () => {
                                                    const file = await selectFile("image/*");
                                                    if (!file) return;
                                                    const result = await serverActions.updateAvatar(file);
                                                    if (result.isErr()) {
                                                        addToast(result.error, 'error');
                                                    }
                                                }}
                                                variant="primary"
                                                size="sm"
                                                class="absolute bottom-0 right-0 rounded-full p-1.5"
                                            >
                                                <Upload class="w-4 h-4" />
                                            </Button>
                                        </Show>
                                    </div>
                                    <div class="flex-1">
                                        <Show
                                            when={isAdmin()}
                                            fallback={
                                                <h3 class="text-lg font-semibold text-fg-base">{config().serverName}</h3>
                                            }
                                        >
                                            <Input
                                                label="Server Name"
                                                value={config().serverName}
                                                onBlur={(e) => saveServerName(e.currentTarget.value)}
                                            />
                                        </Show>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </Show>
                </div>
            ),
        },
        {
            id: 'rights',
            label: 'Rights',
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="User Management" icon={<Users class="w-4 h-4" />}>
                        <div class="space-y-4">
                            <Input
                                value={searchTerm()}
                                onChange={setSearchTerm}
                                placeholder="Search users..."
                                icon={<Search class="w-4 h-4 text-fg-muted" />}
                            />
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableHeader>User</TableHeader>
                                        <TableHeader align="center">Role</TableHeader>
                                        <TableHeader align="center">Actions</TableHeader>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    <For each={filteredUsers()}>
                                        {(user) => (
                                            <TableRow class="hover:bg-bg-overlay">
                                                <TableCell>
                                                    <div class="flex items-center space-x-3">
                                                        <Avatar
                                                            avatarFileId={user.avatarFileId}
                                                            alt={user.username}
                                                            size="sm"
                                                        />
                                                        <span class="font-medium">{user.username}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Select
                                                        value={user.roleId}
                                                        onChange={async (roleId) => {
                                                            const result = await aclActions.updateUserRole(user.userId, roleId as number);
                                                            if (result.isErr()) {
                                                                addToast(result.error, "error")
                                                            }
                                                        }}
                                                        options={roleActions.list().map((role) => ({
                                                            value: role.roleId,
                                                            label: role.roleName,
                                                        }))}
                                                        class="min-w-[120px]"
                                                    />
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Button
                                                        variant="destructive"
                                                        disabled={user.roleId === 1 || !isAdmin()}
                                                        title={user.roleId === 1 ? "Cannot delete owner" : "Delete user"}
                                                        onClick={async () => {
                                                            const confirmed = await confirm({
                                                                title: "Delete User",
                                                                message: `Are you sure you want to delete "${user.username}"? This will remove all their messages and files.`,
                                                                confirmText: "Delete",
                                                                variant: "danger",
                                                            });
                                                            if (!confirmed) return;

                                                            const result = await userActions.delete(user.userId);
                                                            if (result.isErr()) {
                                                                addToast(result.error, "error");
                                                            } else {
                                                                addToast(`User "${user.username}" deleted`, "success");
                                                            }
                                                        }}
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
                    </Card>
                </div>
            ),
        },
        {
            id: 'invitations',
            label: 'Invitations',
            content: (
                <Show
                    when={isAdmin()}
                    fallback={
                        <div class="text-center py-8 text-fg-subtle">
                            You don't have permission to manage invitations.
                        </div>
                    }
                >
                    <div class="space-y-4 mt-6">
                        <Card title="Create New Invitation" icon={<Plus class="w-4 h-4" />}>
                            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div class="md:col-span-1">
                                    <Input
                                        label="Invite Code"
                                        value={newInviteCode()}
                                        onChange={setNewInviteCode}
                                        placeholder="Enter invite code"
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
                                    />
                                </div>
                                <Select
                                    label="Role"
                                    value={newInviteRoleId()}
                                    onChange={setNewInviteRoleId}
                                    options={roleActions.list().filter((role) => role.roleId != 1).map((role) => ({
                                        value: role.roleId.toString(),
                                        label: role.roleName,
                                    }))}
                                />
                            </div>
                            <div class="mt-4">
                                <Button
                                    onClick={createInvite}
                                    class="flex items-center gap-2"
                                >
                                    <Plus class="w-4 h-4" />
                                    Create Invite
                                </Button>
                            </div>
                        </Card>

                        <Card title="Active Invitations" icon={<Users class="w-4 h-4" />}>
                            <div class="flex items-center justify-between mb-4">
                                <div />
                                <Button
                                    onClick={loadInvites}
                                    variant="secondary"
                                    size="sm"
                                >
                                    Refresh
                                </Button>
                            </div>
                            <Show
                                when={invites().length > 0}
                                fallback={
                                    <div class="text-center py-8 text-fg-subtle">
                                        No invitations found. Create one to get started.
                                    </div>
                                }
                            >
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableHeader>Code</TableHeader>
                                            <TableHeader align="center">Uses Left</TableHeader>
                                            <TableHeader align="center">Role</TableHeader>
                                            <TableHeader align="center">Actions</TableHeader>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        <For each={invites()}>
                                            {(invite) => (
                                                <TableRow class="hover:bg-bg-overlay">
                                                    <TableCell style={{ width: "200px" }}>
                                                        <div class="flex items-center gap-2">
                                                            <code class="bg-input px-2 py-1 rounded font-mono text-sm">
                                                                {invite.code}
                                                            </code>
                                                            <Button
                                                                onClick={() => copyInviteCode(invite.code)}
                                                                variant='ghost'
                                                                title="Copy invite code"
                                                            >
                                                                <Copy class="w-4 h-4 text-fg-subtle" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <span class={`px-2 py-1 rounded text-xs font-medium ${invite.availableRegistrations > 0
                                                            ? 'bg-status-success/20 text-status-success'
                                                            : 'bg-status-danger/20 text-status-danger'
                                                            }`}>
                                                            {invite.availableRegistrations}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <span class="px-2 py-1 rounded text-xs font-medium bg-accent-link/20 text-accent-link">
                                                            {roleActions.findById(invite.roleId)?.roleName || 'Unknown'}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Button
                                                            onClick={() => deleteInvite(invite.inviteId)}
                                                            variant='destructive'
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
                        </Card>
                    </div>
                </Show>
            ),
        },
        {
            id: 'logs',
            label: 'Logs',
            content: (
                <Show
                    when={isAdmin()}
                    fallback={
                        <div class="text-center py-8 text-fg-subtle">
                            You don't have permission to view logs.
                        </div>
                    }
                >
                    <div class="space-y-4 mt-6">
                        <Card title="Log Viewer" icon={<FileText class="w-4 h-4" />}>
                            <div class="flex flex-wrap items-center gap-4 mb-4">
                                <div class="flex-1 min-w-[200px]">
                                    <Input
                                        value={logSearchTerm()}
                                        onChange={setLogSearchTerm}
                                        placeholder="Search logs..."
                                        icon={<Search class="w-4 h-4 text-fg-subtle" />}
                                    />
                                </div>
                                <div class="min-w-[150px]">
                                    <Select
                                        value={logCategoryFilter()}
                                        onChange={(val) => setLogCategoryFilter(val as string)}
                                        options={[
                                            { value: '', label: 'All Categories' },
                                            ...logCategories().map((cat) => ({ value: cat, label: cat })),
                                        ]}
                                    />
                                </div>
                                <Button
                                    onClick={loadLogs}
                                    variant="secondary"
                                    size="sm"
                                    disabled={logsLoading()}
                                    class="flex items-center gap-2"
                                >
                                    <RefreshCw class={`w-4 h-4 ${logsLoading() ? 'animate-spin' : ''}`} />
                                    Refresh
                                </Button>
                                <Button
                                    onClick={() => deleteLogs(logCategoryFilter() || undefined)}
                                    variant="destructive"
                                    size="sm"
                                    disabled={logsLoading() || logs().length === 0}
                                    class="flex items-center gap-2"
                                >
                                    <Trash2 class="w-4 h-4" />
                                    Clear {logCategoryFilter() ? 'Category' : 'All'}
                                </Button>
                            </div>

                            <Show
                                when={filteredLogs().length > 0}
                                fallback={
                                    <div class="text-center py-8 text-fg-subtle">
                                        No logs found. Click Refresh to load logs.
                                    </div>
                                }
                            >
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableHeader>Date</TableHeader>
                                            <TableHeader>Category</TableHeader>
                                            <TableHeader>Message</TableHeader>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        <For each={filteredLogs()}>
                                            {(log) => (
                                                <TableRow class="hover:bg-bg-overlay">
                                                    <TableCell class="text-xs text-fg-subtle whitespace-nowrap">
                                                        {formatLogDate(log.date)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span class="px-2 py-1 rounded text-xs font-medium bg-accent-link/20 text-accent-link">
                                                            {log.category}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell class="text-sm font-mono text-fg-base break-all">
                                                        {log.log}
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </For>
                                    </TableBody>
                                </Table>
                                <div class="mt-4 text-sm text-fg-subtle">
                                    Showing {filteredLogs().length} of {logs().length} entries
                                </div>
                            </Show>
                        </Card>
                    </div>
                </Show>
            ),
        },
    ])

    const handleModalOpen = () => {
        if (isAdmin()) {
            loadInvites();
        }
    };

    setTimeout(() => handleModalOpen(), 100);

    return (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-bg-overlay text-fg-base rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold">Server Settings</h2>
                    <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
                        <X class="w-6 h-6" />
                    </Button>
                </div>
                <Tabs items={tabItems()} value={activeTab()} onChange={setActiveTab} />
            </div>
        </div>
    )
}

export default ServerSettingsModal
