import type { Component } from "solid-js";
import { createSignal, createMemo, createEffect, For } from "solid-js";
import { Hash, Volume2, X, Shield } from "lucide-solid";
import { ChannelType, RIGHTS, type Channel } from "../../model";
import { useAcl, useModal, useRole, useChannel } from "../../store/index";
import { useToaster } from "../../components/Toaster";
import { useConfirm } from "../../components/ConfirmDialog";
import Button from "../../components/Button";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Input } from "../../components/Input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/Table";
import Checkbox from "../../components/CheckBox";

interface ChannelSettingsProps {
    channel: Channel;
}

const ChannelSettingsModal: Component<ChannelSettingsProps> = (props) => {
    const { addToast } = useToaster();
    const confirm = useConfirm();
    const [, aclActions] = useAcl();
    const [, modalActions] = useModal();
    const [, roleActions] = useRole();
    const [, channelActions] = useChannel();

    const [name, setName] = createSignal(props.channel.channelName);
    const [roleRights, setRoleRights] = createSignal<Record<number, number>>({});

    createEffect(() => {
        setRoleRights(
            Object.fromEntries(
                roleActions.list()
                    .filter((role) => role.roleId > 2)
                    .map((role) => [
                        role.roleId,
                        aclActions.getGroupRights(props.channel.groupId, role.roleId) || 0,
                    ])
            )
        );
    });

    const tabItems = createMemo(() => [
        {
            id: "general",
            label: "General",
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Channel Info" icon={<Hash class="w-4 h-4" />}>
                        <Input label="Channel Name" value={name()} onChange={setName} />
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
                                                            disabled
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
                    </Card>
                </div>
            ),
        },
    ]);

    const handleSave = async () => {
        const trimmedName = name().trim();
        if (!trimmedName) return;

        if (trimmedName !== props.channel.channelName) {
            const renameResult = await channelActions.rename(
                props.channel.channelId,
                trimmedName
            );

            if (renameResult.isErr()) {
                addToast(`Failed to rename channel: ${renameResult.error}`, "error");
                return;
            }
        }

        modalActions.close();
    };

    const handleDelete = async () => {
        const confirmed = await confirm({
            title: "Delete Channel",
            message: `Are you sure you want to delete the channel "${props.channel.channelName}"?`,
            confirmText: "Delete",
            variant: "danger",
        });
        if (!confirmed) return;

        const result = await channelActions.delete(props.channel.channelId);

        if (result.isErr()) {
            addToast(`Failed to delete channel: ${result.error}`, "error");
            return;
        }

        modalActions.close();
    };

    const ChannelIcon = props.channel.channelType === ChannelType.Text ? Hash : Volume2;

    return (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-bg-overlay rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-fg-base flex items-center gap-2">
                        <ChannelIcon class="w-6 h-6" />
                        Channel Settings
                    </h2>
                    <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
                        <X class="w-6 h-6" />
                    </Button>
                </div>

                <Tabs items={tabItems()} />

                <div class="mt-6 flex justify-between items-center">
                    <Button onClick={handleDelete} variant="destructive">
                        Delete Channel
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

export default ChannelSettingsModal;
