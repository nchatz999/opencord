import type { Component } from "solid-js";
import { Show, createMemo } from "solid-js";
import { X, Calendar, Shield, Circle, MessageSquare, User as UserIcon } from "lucide-solid";
import { useModal, useRole, useContext, useUser } from "../../store/index";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import Card from "../../components/Card";
import { getStatusColor } from "../../utils";

interface UserInfoModalProps {
    userId: number;
}

const UserInfoModal: Component<UserInfoModalProps> = (props) => {
    const [, modalActions] = useModal();
    const [, roleActions] = useRole();
    const [, contextActions] = useContext();
    const [, userActions] = useUser();


    const user = createMemo(() => userActions.findById(props.userId));
    const role = createMemo(() => user() && roleActions.findById(user()?.roleId ?? -1));

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    };

    const handleSendMessage = () => {
        contextActions.set({ type: "dm", id: props.userId });
        modalActions.close();
    };

    return (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-popover rounded-lg p-6 w-full max-w-sm mx-4">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
                        <UserIcon class="w-6 h-6" />
                        User Profile
                    </h2>
                    <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
                        <X class="w-6 h-6" />
                    </Button>
                </div>

                <Show when={user()}>
                    {(u) => (
                        <div class="space-y-4">
                            <div class="flex items-center gap-4">
                                <Avatar
                                    avatarFileId={u().avatarFileId}
                                    alt={u().username}
                                    size="xl"
                                />
                                <div>
                                    <div class="flex items-center gap-2">
                                        <h3 class="text-xl font-bold text-foreground-bright">
                                            {u().username}
                                        </h3>
                                        <Circle
                                            size={10}
                                            class={`${getStatusColor(u().status)} fill-current`}
                                        />
                                    </div>
                                    <p class="text-sm text-muted-foreground">
                                        {role()?.roleName ?? "Unknown"}
                                    </p>
                                </div>
                            </div>

                            <Card>
                                <div class="space-y-3">
                                    <div class="flex items-center gap-3">
                                        <Shield size={16} class="text-muted-foreground" />
                                        <div>
                                            <p class="text-xs text-muted-foreground">Role</p>
                                            <p class="text-sm text-foreground">
                                                {role()?.roleName ?? "Unknown"}
                                            </p>
                                        </div>
                                    </div>

                                    <div class="flex items-center gap-3">
                                        <Calendar size={16} class="text-muted-foreground" />
                                        <div>
                                            <p class="text-xs text-muted-foreground">Member Since</p>
                                            <p class="text-sm text-foreground">
                                                {formatDate(u().createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </Card>

                            <Button
                                onClick={handleSendMessage}
                                variant="primary"
                                class="w-full flex items-center justify-center gap-2"
                            >
                                <MessageSquare size={16} />
                                Send Message
                            </Button>
                        </div>
                    )}
                </Show>
            </div>
        </div>
    );
};

export default UserInfoModal;
