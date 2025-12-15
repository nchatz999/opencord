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
  Mic,
  Headphones,
  Circle,
  Monitor,
  Trash2,
  Calendar,
  Settings,
} from "lucide-solid";
import { connection } from "../store";
import { useAuth, useModal, usePlayback, useMicrophone, useCamera, useScreenShare, useOutput, useUser, type AudioOutputDevice } from "../store/index";
import { useApp } from "../store/app";
import { Input } from "../components/Input";
import Button from "../components/Button";
import Select from "../components/Select";
import Slider from "../components/Slider";
import { Tabs } from "../components/Tabs";
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from "../components/Table";
import { UserStatusType, type Session } from "../model";
import { useToaster } from "../components/Toaster";

const UserSettingsModal: Component = () => {
  const [, authActions] = useAuth();
  const [, appActions] = useApp();
  const [, modalActions] = useModal();
  const [, playbackActions] = usePlayback();
  const [, userActions] = useUser();
  const [, microphoneActions] = useMicrophone();
  const [, cameraActions] = useCamera();
  const [, screenShareActions] = useScreenShare();
  const [, outputActions] = useOutput();
  const user = () => authActions.getUser();


  const [username, setUsername] = createSignal(user().username);
  const [avatarFile, setAvatarFile] = createSignal<File | null>(null);
  const [_avatarPreview, setAvatarPreview] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;

  const [outputVolume, setOutputVolume] = createSignal(50);

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

  const getStatusColor = (status: UserStatusType) => {
    const option = statusOptions.find(opt => opt.value === status);
    return option?.color || 'text-status-offline';
  };

  const handleStatusChange = async (newStatus: UserStatusType) => {
    const result = await userActions.updateStatus(user().userId, newStatus);
    if (result.isErr()) {
      addToast(result.error, "error");
    }
  };

  onMount(async () => {
    await playbackActions.resume()
    loadSessions();
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
          <Input label="Username" value={username()} onChange={setUsername} />

          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-3 flex items-center">
              <Circle class="w-4 h-4 mr-2" />
              Status
            </h3>
            <div class="space-y-3">
              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Current Status
                </label>
                <Select
                  options={statusOptions.map(option => ({
                    value: option.value,
                    label: option.label
                  }))}
                  value={user().status}
                  onChange={(value) => handleStatusChange(value as UserStatusType)}
                  class="w-full"
                />
              </div>
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
          </div>


          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Upload class="w-4 h-4 mr-2" />
              Change Avatar
            </h3>
            <div class="flex flex-col items-center space-y-3">
              <div class="relative w-24 h-24">
                <img
                  src={`/user/${user().avatarFileId}/avatar`}
                  alt="Avatar"
                  class="w-24 h-24 rounded-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef?.click()}
                  class="absolute bottom-0 right-0 bg-primary p-2 rounded-full hover:bg-primary-hover transition-colors"
                >
                  <Upload class="w-4 h-4 text-primary-foreground" />
                </button>
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
          </div>
        </div>
      ),
    },
    {
      id: "audio",
      label: "Audio",
      icon: <Volume2 class="w-4 h-4" />,
      content: (
        <div class="space-y-4 mt-6">
          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Mic class="w-4 h-4 mr-2" />
              Microphone
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Input Device
                </label>
                <Select
                  options={microphoneActions.listDevices().map((device: MediaDeviceInfo) => ({
                    value: device.deviceId,
                    label: device.label,
                  }))}
                  value={microphoneActions.getDevice()}
                  onChange={(device) => {
                    microphoneActions.setDevice(device as string)
                  }}
                  class="w-full"
                />
              </div>


              <div class="flex items-center space-x-2">
                <Mic class="w-4 h-4" />
                <Slider
                  min={0}
                  max={200}
                  value={microphoneActions.getVolume()}
                  onChange={(e) => microphoneActions.setVolume(e)}
                  class="w-full"
                />
              </div>

            </div>
          </div>

          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Headphones class="w-4 h-4 mr-2" />
              Output
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Output Device
                </label>
                <Select
                  options={outputActions.getAvailableOutputs().map(
                    (device: AudioOutputDevice) => ({
                      value: device.deviceId,
                      label: device.label,
                    })
                  )}
                  value={outputActions.getSelectedOutput()?.deviceId || ""}
                  onChange={(deviceId) => {
                    const device = outputActions.getAvailableOutputs().find(d => d.deviceId === deviceId);
                    if (device) {
                      outputActions.setOutput(device);
                    }
                  }}
                  class="w-full"
                />
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Output Volume
                </label>
                <div class="flex items-center space-x-2">
                  <Headphones class="w-4 h-4" />
                  <Slider
                    min={0}
                    max={200}
                    value={outputVolume()}
                    onChange={(value) => setOutputVolume(value)}
                    class="w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    {
      id: "security",
      label: "Security",
      icon: <Shield class="w-4 h-4" />,
      content: (
        <div class="space-y-4">
          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Lock class="w-4 h-4 mr-2" />
              Change Password
            </h3>
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
          </div>
        </div>
      ),
    },
    {
      id: "quality",
      label: "Quality",
      icon: <Settings class="w-4 h-4" />,
      content: (
        <div class="space-y-4 mt-6">
          <div class="p-4 bg-card rounded-md">
            <h3 class="text-sm font-medium mb-4 flex items-center">
              <Settings class="w-4 h-4 mr-2" />
              Bitrate Settings
            </h3>

            <div class="space-y-6">
              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Camera Quality: {cameraActions.getQuality()} bps
                </label>
                <Slider
                  value={cameraActions.getQuality()}
                  min={500000}
                  max={8000000}
                  onChange={(value) => {
                    cameraActions.setQuality(value);
                  }}
                />
                <p class="text-xs text-secondary-text mt-1">
                  Adjusts video quality for camera stream
                </p>
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Screen Share Quality: {screenShareActions.getQuality()} bps
                </label>
                <Slider
                  value={screenShareActions.getQuality()}
                  min={500000}
                  max={8000000}
                  onChange={(value) => {
                    screenShareActions.setQuality(value);
                  }}
                />
                <p class="text-xs text-secondary-text mt-1">
                  Adjusts video quality for screen sharing
                </p>
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-foreground">
                  Audio Quality: {microphoneActions.getQuality()} bps
                </label>
                <Slider
                  value={microphoneActions.getQuality()}
                  min={64000}
                  max={320000}
                  onChange={(value) => {
                    microphoneActions.setQuality(value);
                  }}
                />
                <p class="text-xs text-secondary-text mt-1">
                  Adjusts audio bitrate for microphone
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: <Monitor class="w-4 h-4" />,
      content: (
        <div class="space-y-6 mt-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Monitor class="w-5 h-5 text-foreground" />
              <h3 class="text-lg font-semibold text-foreground">Active Sessions</h3>
            </div>
            <Button
              onClick={loadSessions}
              variant="secondary"
              size="sm"
            >
              Refresh
            </Button>
          </div>

          <div class="bg-card rounded-lg p-4">
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
                    <TableHeader >Actions</TableHeader>
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
                        <TableCell >
                          <button
                            onClick={() => terminateSession(session.sessionToken)}
                            disabled={isCurrentSession(session.sessionToken)}
                            class="p-2 hover:bg-destructive/20 text-destructive hover:text-destructive rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isCurrentSession(session.sessionToken) ? "Cannot terminate current session" : "Terminate session"}
                          >
                            <Trash2 class="w-4 h-4" />
                          </button>
                        </TableCell>
                      </TableRow>
                    )}
                  </For>
                </TableBody>
              </Table>
            </Show>

            <div class="mt-4 p-3 bg-input rounded-lg">
              <h4 class="text-sm font-medium text-foreground mb-2">Session Information</h4>
              <ul class="text-xs text-secondary-text space-y-1">
                <li>• Sessions allow you to stay logged in across different devices</li>
                <li>• You can terminate sessions from other devices for security</li>
                <li>• Your current session cannot be terminated from this interface</li>
                <li>• Sessions may expire automatically after a period of inactivity</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
  ]);

  return (
    <div class="fixed inset-0 bg-black text-foreground bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">User Settings</h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-end space-x-2">
          <Button onClick={async () => {
            await microphoneActions.stop();
            await authActions.logout();
            await connection.disconnect();
            modalActions.close();
            appActions.setView("unauthenticated");
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
