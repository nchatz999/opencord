import type { Component } from "solid-js";
import { createSignal, createMemo, For } from "solid-js";
import { Folder, X, Shield } from "lucide-solid";
import { RIGHTS, type Group } from "../../model";
import { useModal, useRole, useGroup, useAcl } from "../../store/index";
import { Input } from "../../components/Input";
import Button from "../../components/Button";
import { useToaster } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";

interface GroupSettingsProps {
    group: Group;
}

const GroupSettingsModal: Component<GroupSettingsProps> = (props) => {
    const [, modalActions] = useModal();
    const [, roleActions] = useRole();
    const [, groupActions] = useGroup();
    const [, aclActions] = useAcl();
    const { addToast } = useToaster();
    const confirm = useConfirm();

    const [name, setName] = createSignal(props.group.groupName);
    const [roleRights, setRoleRights] = createSignal<Record<number, number>>(
        Object.fromEntries(
            roleActions.list()
                .filter((role) => role.roleId > 2)
                .map((role) => [
                    role.roleId,
                    aclActions.getGroupRights(props.group.groupId, role.roleId) ?? 0,
                ])
        )
    );

    const tabItems = createMemo(() => [
        {
            id: "general",
            label: "General",
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Group Info" icon={<Folder class="w-4 h-4" />}>
                        <Input label="Group Name" value={name()} onChange={setName} />
                    </Card>
                </div>
            ),
        },
        {
            id: "permissions",
            label: "Permissions",
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Role Permissions" icon={<Shield class="w-4 h-4" />}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeader>Role</TableHeader>
                                    <For each={Object.entries(RIGHTS)}>
                                        {([key]) => <TableHeader align="center">{key}</TableHeader>}
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
                                                    <TableCell align="center">
                                                        <Checkbox
                                                            checked={roleRights()[role.roleId] >= (right as number)}
                                                            onChange={(checked) => {
                                                                setRoleRights((prev) => ({
                                                                    ...prev,
                                                                    [role.roleId]: checked
                                                                        ? (right as number)
                                                                        : (right as number) >> 1,
                                                                }));
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
                    </Card>
                </div>
            ),
        },
    ]);

    const handleSave = async () => {
        const trimmedName = name().trim();
        if (!trimmedName) {
            addToast("Please enter a group name", "error");
            return;
        }

        if (trimmedName !== props.group.groupName) {
            const renameResult = await groupActions.rename(props.group.groupId, trimmedName);
            if (renameResult.isErr()) {
                addToast(`Failed to rename group: ${renameResult.error}`, "error");
                return;
            }
        }

        for (const [roleId, right] of Object.entries(roleRights())) {
            const aclResult = await aclActions.grant({
                groupId: props.group.groupId,
                roleId: Number(roleId),
                rights: right,
            });

            if (aclResult.isErr()) {
                addToast(`Failed to update permissions: ${aclResult.error}`, "error");
                return;
            }
        }

        modalActions.close();
    };

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: "Delete Group",
            message: `Are you sure you want to delete the group "${props.group.groupName}"?`,
            confirmText: "Delete",
            variant: "danger",
        });
        if (!confirmed) return;

        const result = await groupActions.delete(props.group.groupId);

        if (result.isErr()) {
            addToast(`Failed to delete group: ${result.error}`, "error");
            return;
        }

        modalActions.close();
    };

    return (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-popover rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
                        <Folder class="w-6 h-6" />
                        Group Settings
                    </h2>
                    <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
                        <X class="w-6 h-6" />
                    </Button>
                </div>

                <Tabs items={tabItems()} />

                <div class="mt-6 flex justify-between items-center">
                    <Button onClick={handleDelete} variant="destructive">
                        Delete Group
                    </Button>
                    <div class="flex gap-2">
                        <Button onClick={() => modalActions.close()} variant="secondary">
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

export default GroupSettingsModal;
