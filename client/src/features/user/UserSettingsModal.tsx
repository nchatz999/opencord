import type { Component } from "solid-js";
import {
    createSignal,
    createMemo,
    Show,
    onMount,
    For,
} from "solid-js";
import {
    Shield,
    Volume2,
    X,
    Lock,
    Upload,
    User as UserIcon,
    Headphones,
    Circle,
    Monitor,
    Trash2,
    Calendar,
    Palette,
    Settings,
} from "lucide-solid";
import { connection, useAuth, useModal, useUser, useSound, useTheme } from "../../store/index";
import { useApp } from "../../store/app";
import { useLiveKit, type CameraQuality, type ScreenQuality, type ScreenCodec, type ScreenContentHint } from "../../lib/livekit";
import { Input } from "../../components/Input";
import Button from "../../components/Button";
import Select from "../../components/Select";
import Slider from "../../components/Slider";
import Avatar from "../../components/Avatar";
import Checkbox from "../../components/CheckBox";
import { Tabs } from "../../components/Tabs";
import Card from "../../components/Card";
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from "../../components/Table";
import { UserStatusType, type Session } from "../../model";
import { useToaster } from "../../components/Toaster";
import { getStatusColor } from "../../utils";


const UserSettingsModal: Component = () => {
    const [, authActions] = useAuth();
    const [, appActions] = useApp();
    const [, modalActions] = useModal();
    const [, userActions] = useUser();
    const [, soundActions] = useSound();
    const [themeState, themeActions] = useTheme();
    const [, livekitActions] = useLiveKit();
    const user = () => authActions.getUser();


    const [username, setUsername] = createSignal(user().username);
    const [avatarFile, setAvatarFile] = createSignal<File | null>(null);
    const [_avatarPreview, setAvatarPreview] = createSignal<string | null>(null);
    let fileInputRef: HTMLInputElement | undefined;

    const [currentPassword, setCurrentPassword] = createSignal("");
    const [newPassword, setNewPassword] = createSignal("");
    const [confirmPassword, setConfirmPassword] = createSignal("");
    const [passwordError, setPasswordError] = createSignal("");
    const [sessions, setSessions] = createSignal<Session[]>([]);

    const { addToast } = useToaster();

    const statusOptions = [
        { value: UserStatusType.Online, label: 'Online', color: 'text-status-online' },
        { value: UserStatusType.Away, label: 'Away', color: 'text-status-away' },
        { value: UserStatusType.DoNotDisturb, label: 'Do Not Disturb', color: 'text-status-dnd' },
        { value: UserStatusType.Offline, label: 'Offline', color: 'text-status-offline' },
    ];

    const handleStatusChange = async (newStatus: UserStatusType) => {
        const result = await userActions.updateStatus(user().userId, newStatus);
        if (result.isErr()) {
            addToast(result.error, "error");
        }
    };

    onMount(() => {
        loadSessions();
        livekitActions.refreshDevices();
    });

    const loadSessions = async () => {
        const result = await authActions.getSessions();

        if (result.isErr()) {
            addToast(result.error, "error");
            return
        }
        setSessions(result.value);
    };

    const terminateSession = async (sessionToken: string) => {
        const result = await authActions.terminateSession(sessionToken);

        if (result.isErr()) {
            addToast(result.error, "error");
            return;
        }

        setSessions(sessions().filter(session => session.sessionToken !== sessionToken));
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const isCurrentSession = (sessionToken: string) => {
        return authActions.getSession().sessionToken === sessionToken;
    };


    const handleChangePassword = () => {
        setPasswordError("");

        if (!currentPassword()) {
            setPasswordError("Current password is required");
            return;
        }

        if (!newPassword()) {
            setPasswordError("New password is required");
            return;
        }

        if (newPassword() !== confirmPassword()) {
            setPasswordError("Passwords do not match");
            return;
        }

        if (newPassword().length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }


        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");

    };

    const handleAvatarChange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files[0]) {
            const file = target.files[0];

            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64data = (reader.result as string).split(',')[1];

                const result = await userActions.updateAvatar(file.name, file.type, base64data);

                if (result.isErr()) {
                    addToast(result.error, "error");
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAvatarUpload = async () => {
        if (!avatarFile()) return;
        setAvatarPreview(null);
        setAvatarFile(null);
    };

    const tabItems = createMemo(() => [
        {
            id: "account",
            label: "Account",
            icon: <UserIcon class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Profile" icon={<UserIcon class="w-4 h-4" />}>
                        <Input label="Username" value={username()} onChange={setUsername} />
                    </Card>

                    <Card title="Status" icon={<Circle class="w-4 h-4" />}>
                        <div class="space-y-3">
                            <Select
                                label="Current Status"
                                options={statusOptions.map(option => ({
                                    value: option.value,
                                    label: option.label
                                }))}
                                value={user().status}
                                onChange={(value) => handleStatusChange(value as UserStatusType)}
                                class="w-full"
                            />
                            <div class="flex items-center space-x-2 text-sm">
                                <Circle
                                    size={12}
                                    class={`${getStatusColor(user().status)} fill-current`}
                                />
                                <span class="text-secondary-text">
                                    Your status is visible to other users
                                </span>
                            </div>
                        </div>
                    </Card>


                    <Card title="Change Avatar" icon={<Upload class="w-4 h-4" />}>
                        <div class="flex flex-col items-center space-y-3">
                            <div class="relative w-24 h-24">
                                <Avatar
                                    avatarFileId={user().avatarFileId}
                                    alt="Avatar"
                                    size="xl"
                                />
                                <Button
                                    onClick={() => fileInputRef?.click()}
                                    variant="primary"
                                    size="sm"
                                    class="absolute bottom-0 right-0 p-2 rounded-full"
                                >
                                    <Upload class="w-4 h-4" />
                                </Button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleAvatarChange}
                                    class="hidden"
                                />
                            </div>

                            <Show when={avatarFile()}>
                                <div class="flex space-x-2">
                                    <Button onClick={handleAvatarUpload} size="sm">
                                        Upload Avatar
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setAvatarPreview(null);
                                            setAvatarFile(null);
                                        }}
                                        variant="secondary"
                                        size="sm"
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </Show>

                            <p class="text-xs text-secondary-text">
                                Recommended: Square image, at least 128x128px
                            </p>
                        </div>
                    </Card>
                </div>
            ),
        },
        {
            id: "audio",
            label: "Audio",
            icon: <Volume2 class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Input" icon={<Volume2 class="w-4 h-4" />}>
                        <Select
                            label="Microphone"
                            options={livekitActions.getAudioInputDevices().map((d) => ({ value: d.deviceId, label: d.label }))}
                            value={livekitActions.getActiveAudioInput()}
                            onChange={async (id) => await livekitActions.setAudioInputDevice(id as string)}
                            class="w-full"
                        />
                        <Checkbox
                            label="Noise Cancellation"
                            checked={livekitActions.getNoiseCancellation()}
                            onChange={(checked) => livekitActions.setNoiseCancellation(checked)}
                            class="mt-3"
                        />
                    </Card>

                    <Card title="Output" icon={<Headphones class="w-4 h-4" />}>
                        <Select
                            label="Speaker"
                            options={livekitActions.getAudioOutputDevices().map((d) => ({ value: d.deviceId, label: d.label }))}
                            value={livekitActions.getActiveAudioOutput()}
                            onChange={async (id) => await livekitActions.setAudioOutputDevice(id as string)}
                            class="w-full"
                        />
                    </Card>

                    <Card>
                        <Slider
                            title="Notification Sounds Volume"
                            min={0}
                            max={100}
                            value={soundActions.getVolume()}
                            onChange={(value) => soundActions.setVolume(value)}
                        />
                    </Card>
                </div>
            ),
        },

        {
            id: "security",
            label: "Security",
            icon: <Shield class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Change Password" icon={<Lock class="w-4 h-4" />}>
                        <div class="space-y-3">
                            <Input
                                label="Current Password"
                                value={currentPassword()}
                                onChange={setCurrentPassword}
                                type="password"
                                placeholder="Enter current password"
                            />
                            <Input
                                label="New Password"
                                value={newPassword()}
                                onChange={setNewPassword}
                                type="password"
                                placeholder="Enter new password"
                            />
                            <Input
                                label="Confirm New Password"
                                value={confirmPassword()}
                                onChange={setConfirmPassword}
                                type="password"
                                placeholder="Confirm new password"
                                error={passwordError()}
                            />
                            <Button onClick={handleChangePassword}>Update Password</Button>
                        </div>
                    </Card>
                </div>
            ),
        },
        {
            id: "appearance",
            label: "Appearance",
            icon: <Palette class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Theme" icon={<Palette class="w-4 h-4" />}>
                        <Select
                            label="Color Theme"
                            options={themeActions.getThemes().map((theme) => ({
                                value: theme.name,
                                label: theme.label,
                            }))}
                            value={themeState.current}
                            onChange={(value) => themeActions.setTheme(value as string)}
                            class="w-full"
                        />
                    </Card>
                </div>
            ),
        },
        {
            id: "quality",
            label: "Quality",
            icon: <Settings class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Camera Quality" icon={<Settings class="w-4 h-4" />}>
                        <Select
                            label="Quality"
                            options={livekitActions.getCameraQualityOptions()}
                            value={livekitActions.getCameraQuality()}
                            onChange={(value) => livekitActions.setCameraQuality(value as CameraQuality)}
                            class="w-full"
                        />
                    </Card>
                    <Card title="Screen Share Quality" icon={<Monitor class="w-4 h-4" />}>
                        <div class="space-y-3">
                            <Select
                                label="Quality"
                                options={livekitActions.getScreenQualityOptions()}
                                value={livekitActions.getScreenQuality()}
                                onChange={(value) => livekitActions.setScreenQuality(value as ScreenQuality)}
                                class="w-full"
                            />
                            <Select
                                label="Codec"
                                options={livekitActions.getScreenCodecOptions()}
                                value={livekitActions.getScreenCodec()}
                                onChange={(value) => livekitActions.setScreenCodec(value as ScreenCodec)}
                                class="w-full"
                            />
                            <Select
                                label="Content Type"
                                options={livekitActions.getScreenContentHintOptions()}
                                value={livekitActions.getScreenContentHint()}
                                onChange={(value) => livekitActions.setScreenContentHint(value as ScreenContentHint)}
                                class="w-full"
                            />
                        </div>
                    </Card>
                </div>
            ),
        },
        {
            id: "sessions",
            label: "Sessions",
            icon: <Monitor class="w-4 h-4" />,
            content: (
                <div class="space-y-4 mt-6">
                    <Card title="Active Sessions" icon={<Monitor class="w-4 h-4" />}>
                        <div class="flex justify-end mb-4">
                            <Button
                                onClick={loadSessions}
                                variant="secondary"
                                size="sm"
                            >
                                Refresh
                            </Button>
                        </div>
                        <Show
                            when={sessions().length > 0}
                            fallback={
                                <div class="text-center py-8 text-muted-foreground-dark">
                                    {"No active sessions found."}
                                </div>
                            }
                        >
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableHeader>Session</TableHeader>
                                        <TableHeader>Created</TableHeader>
                                        <TableHeader>Expires</TableHeader>
                                        <TableHeader align="center">Actions</TableHeader>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    <For each={sessions()}>
                                        {(session) => (
                                            <TableRow class="hover:bg-muted">
                                                <TableCell>
                                                    <div class="flex items-center gap-2">
                                                        <span class="text-foreground font-medium">
                                                            Session #{session.sessionId}
                                                        </span>
                                                        <Show when={isCurrentSession(session.sessionToken)}>
                                                            <span class="px-2 py-1 rounded text-xs font-medium bg-success/20 text-success">
                                                                Current
                                                            </span>
                                                        </Show>
                                                    </div>
                                                </TableCell>
                                                <TableCell class="text-secondary-text text-sm">
                                                    <div class="flex items-center gap-1">
                                                        <Calendar class="w-4 h-4" />
                                                        {formatDate(session.createdAt)}
                                                    </div>
                                                </TableCell>
                                                <TableCell class="text-secondary-text text-sm">
                                                    <Show
                                                        when={session.expiresAt}
                                                        fallback={<span class="text-muted-foreground-dark">Never</span>}
                                                    >
                                                        {formatDate(session.expiresAt)}
                                                    </Show>
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Button
                                                        onClick={() => terminateSession(session.sessionToken)}
                                                        disabled={isCurrentSession(session.sessionToken)}
                                                        variant="ghost"
                                                        size="sm"
                                                        class="p-2 hover:bg-destructive/20 text-destructive hover:text-destructive"
                                                        title={isCurrentSession(session.sessionToken) ? "Cannot terminate current session" : "Terminate session"}
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

                        <Card.Sub class="mt-4">
                            <h4 class="text-sm font-medium text-foreground mb-2">Session Information</h4>
                            <ul class="text-xs text-secondary-text space-y-1">
                                <li>• Sessions allow you to stay logged in across different devices</li>
                                <li>• You can terminate sessions from other devices for security</li>
                                <li>• Your current session cannot be terminated from this interface</li>
                                <li>• Sessions may expire automatically after a period of inactivity</li>
                            </ul>
                        </Card.Sub>
                    </Card>
                </div>
            ),
        },
    ]);

    return (
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-popover text-foreground rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-2xl font-bold">User Settings</h2>
                    <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
                        <X class="w-6 h-6" />
                    </Button>
                </div>
                <Tabs items={tabItems()} />
                <div class="mt-6 flex justify-end gap-2">
                    <Button onClick={async () => {
                        await authActions.logout();
                        await connection.disconnect();
                        modalActions.close();
                        appActions.setView({ type: "unauthenticated" });
                    }}
                        variant="destructive">Logout</Button>
                    <Button onClick={() => modalActions.close()} variant="secondary">
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default UserSettingsModal;
