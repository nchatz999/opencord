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
import { connection, microphone, modalDomain, outputManager, userDomain, camera, screenShare } from "../store";
import { Input } from "../components/Input";
import Button from "../components/Button";
import Select from "../components/Select";
import Slider from "../components/Slider";
import { Tabs } from "../components/Tabs";
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from "../components/Table";
import { fetchApi } from "../utils";
import { clearSession } from "../contexts/Session";
import { UserStatusType } from "../model";
import { useToaster } from "../components/Toaster";
import { match } from "opencord-utils";
import type { AudioOutputDevice } from "../contexts/OutputProvider";

const UserSettingsModal: Component = () => {
  const user = userDomain.getCurrentUser();


  const [username, setUsername] = createSignal(user.username);
  const [avatarFile, setAvatarFile] = createSignal<File | null>(null);
  const [_avatarPreview, setAvatarPreview] = createSignal<string | null>(null);
  let fileInputRef: HTMLInputElement | undefined;

  const [inputVolume, setInputVolume] = createSignal("50");
  const [outputVolume, setOutputVolume] = createSignal("50");

  const [cameraQuality, setCameraQuality] = createSignal(camera.getQuality() * 100);
  const [screenQuality, setScreenQuality] = createSignal(screenShare.getQuality() * 100);
  const [audioQuality, setAudioQuality] = createSignal(microphone.getQuality() * 100);

  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [passwordError, setPasswordError] = createSignal("");

  const [sessions, setSessions] = createSignal<any[]>([]);
  const [loadingSessions, setLoadingSessions] = createSignal(false);

  const { addToast } = useToaster();

  const statusOptions = [
    { value: UserStatusType.Online, label: 'Online', color: 'text-green-500' },
    { value: UserStatusType.Away, label: 'Away', color: 'text-yellow-500' },
    { value: UserStatusType.DoNotDisturb, label: 'Do Not Disturb', color: 'text-red-500' },
    { value: UserStatusType.Invisible, label: 'Invisible', color: 'text-gray-500' },
    { value: UserStatusType.Offline, label: 'Offline', color: 'text-gray-500' },
  ];

  const getStatusColor = (status: UserStatusType) => {
    const option = statusOptions.find(opt => opt.value === status);
    return option?.color || 'text-gray-500';
  };

  const handleStatusChange = async (newStatus: UserStatusType) => {
    try {
      const result = await fetchApi(`/user/${user.userId}/manual-status`, {
        method: 'PUT',
        body: { manualStatus: newStatus }
      });

      if (!result.ok)
        addToast(result.error.reason, "error")

    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  onMount(async () => {
    loadSessions();
  });

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const result = await fetchApi<any[]>("/auth/sessions", {
        method: "GET",
      });

      if (!result.ok) {
        console.error("Failed to load sessions:", result.error);
        addToast("Failed to load sessions", "error");
      }
    } catch (error) {
      console.error("Error loading sessions:", error);
      addToast("Error loading sessions", "error");
    } finally {
      setLoadingSessions(false);
    }
  };

  const terminateSession = async (sessionToken: string) => {
    setLoadingSessions(true);
    try {
      const result = await fetchApi("/auth/logout", {
        method: "POST",
        body: { session_token: sessionToken },
      });

      match(result, {
        ok: () => {
          setSessions(sessions().filter(session => session.sessionToken !== sessionToken));
          addToast("Session terminated successfully", "success");
        },
        err: (error) => {
          const message = (error as any)?.reason || "Failed to terminate session";
          addToast(message, "error");
        },
      });
    } catch (error) {
      console.error("Error terminating session:", error);
      addToast("Error terminating session", "error");
    } finally {
      setLoadingSessions(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const isCurrentSession = (sessionToken: string) => {
    return sessions().length > 0 && sessions()[0].sessionToken === sessionToken;
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

        const result = await fetchApi('/user/avatar', {
          method: 'PUT',
          body: {
            fileName: file.name,
            contentType: file.type,
            data: base64data
          }
        });

        if (result.isErr()) {
          addToast(result.error.reason, "error");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAvatarUpload = async () => {
    if (!avatarFile()) return;

    setAvatarPreview(null);
    setAvatarFile(null);

    console.log("Avatar uploaded successfully");
  };

  const tabItems = createMemo(() => [
    {
      id: "account",
      label: "Account",
      icon: <UserIcon class="w-4 h-4" />,
      content: (
        <div class="space-y-4 mt-6">
          <Input label="Username" value={username()} onChange={setUsername} />

          <div class="p-4 bg-[#2f3136] rounded-md">
            <h3 class="text-sm font-medium mb-3 flex items-center">
              <Circle class="w-4 h-4 mr-2" />
              Status
            </h3>
            <div class="space-y-3">
              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Current Status
                </label>
                <Select
                  options={statusOptions.map(option => ({
                    value: option.value,
                    label: option.label
                  }))}
                  value={userDomain.getCurrentUser().status}
                  onChange={(value) => handleStatusChange(value as UserStatusType)}
                  class="w-full"
                />
              </div>
              <div class="flex items-center space-x-2 text-sm">
                <Circle
                  size={12}
                  class={`${getStatusColor(userDomain.getCurrentUser().status)} fill-current`}
                />
                <span class="text-[#b9bbbe]">
                  Your status is visible to other users
                </span>
              </div>
            </div>
          </div>


          <div class="p-4 bg-[#2f3136] rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Upload class="w-4 h-4 mr-2" />
              Change Avatar
            </h3>
            <div class="flex flex-col items-center space-y-3">
              <div class="relative w-24 h-24">
                <img
                  src={`/api/user/${userDomain.getCurrentUser().avatarFileId}/avatar`}
                  alt="Avatar"
                  class="w-24 h-24 rounded-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef?.click()}
                  class="absolute bottom-0 right-0 bg-[#5865f2] p-2 rounded-full hover:bg-[#4752c4] transition-colors"
                >
                  <Upload class="w-4 h-4 text-white" />
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

              <p class="text-xs text-[#b9bbbe]">
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
          <div class="p-4 bg-[#2f3136] rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Mic class="w-4 h-4 mr-2" />
              Microphone
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Input Device
                </label>
                <Select
                  options={microphone.listDevices().map((device: MediaDeviceInfo) => ({
                    value: device.deviceId,
                    label: device.label,
                  }))}
                  value={microphone.getDevice()}
                  onChange={(device) => {
                    microphone.setDevice(device as string)
                  }}
                  class="w-full"
                />
              </div>


              <div class="flex items-center space-x-2">
                <Mic class="w-4 h-4" />
                <Slider
                  min={0}
                  max={200}
                  value={microphone.getVolume()}
                  onChange={(e) => microphone.setVolume(e)}
                  class="w-full"
                />
              </div>

            </div>
          </div>

          <div class="p-4 bg-[#2f3136] rounded-md">
            <h3 class="text-sm font-medium mb-2 flex items-center">
              <Headphones class="w-4 h-4 mr-2" />
              Output
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Output Device
                </label>
                <Select
                  options={outputManager.getAvailableOutputs().map(
                    (device: AudioOutputDevice) => ({
                      value: device.deviceId,
                      label: device.label,
                    })
                  )}
                  value={outputManager.getSelectedOutput()?.deviceId || ""}
                  onChange={(deviceId) => {
                    const device = outputManager.getAvailableOutputs().find(d => d.deviceId === deviceId);
                    if (device) {
                      outputManager.setOutput(device);
                    }
                  }}
                  class="w-full"
                />
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Output Volume
                </label>
                <div class="flex items-center space-x-2">
                  <Headphones class="w-4 h-4" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={outputVolume()}
                    onInput={(e) => setOutputVolume(e.currentTarget.value)}
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
          <div class="p-4 bg-[#2f3136] rounded-md">
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
          <div class="p-4 bg-[#2f3136] rounded-md">
            <h3 class="text-sm font-medium mb-4 flex items-center">
              <Settings class="w-4 h-4 mr-2" />
              Bitrate Settings
            </h3>

            <div class="space-y-6">
              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Camera Quality: {Math.round(cameraQuality())}%
                </label>
                <Slider
                  value={cameraQuality()}
                  min={10}
                  max={100}
                  onChange={(value) => {
                    setCameraQuality(value);
                    camera.setQuality(value / 100);
                  }}
                />
                <p class="text-xs text-[#b9bbbe] mt-1">
                  Adjusts video quality for camera stream
                </p>
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Screen Share Quality: {Math.round(screenQuality())}%
                </label>
                <Slider
                  value={screenQuality()}
                  min={10}
                  max={100}
                  onChange={(value) => {
                    setScreenQuality(value);
                    screenShare.setQuality(value / 100);
                  }}
                />
                <p class="text-xs text-[#b9bbbe] mt-1">
                  Adjusts video quality for screen sharing
                </p>
              </div>

              <div>
                <label class="block mb-2 text-sm font-medium text-[#dcddde]">
                  Audio Quality: {Math.round(audioQuality())}%
                </label>
                <Slider
                  value={audioQuality()}
                  min={10}
                  max={100}
                  onChange={(value) => {
                    setAudioQuality(value);
                    microphone.setQuality(value / 100);
                  }}
                />
                <p class="text-xs text-[#b9bbbe] mt-1">
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
              <Monitor class="w-5 h-5 text-[#dcddde]" />
              <h3 class="text-lg font-semibold text-[#dcddde]">Active Sessions</h3>
            </div>
            <Button
              onClick={loadSessions}
              variant="secondary"
              size="sm"
              disabled={loadingSessions()}
            >
              Refresh
            </Button>
          </div>

          <div class="bg-[#2f3136] rounded-lg p-4">
            <Show
              when={sessions().length > 0}
              fallback={
                <div class="text-center py-8 text-[#72767d]">
                  {loadingSessions() ? "Loading sessions..." : "No active sessions found."}
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
                      <TableRow class="hover:bg-[#383a40]">
                        <TableCell>
                          <div class="flex items-center gap-2">
                            <span class="text-[#dcddde] font-medium">
                              Session #{session.sessionId}
                            </span>
                            <Show when={isCurrentSession(session.sessionToken)}>
                              <span class="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                                Current
                              </span>
                            </Show>
                          </div>
                        </TableCell>
                        <TableCell class="text-[#b9bbbe] text-sm">
                          <div class="flex items-center gap-1">
                            <Calendar class="w-4 h-4" />
                            {formatDate(session.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell class="text-[#b9bbbe] text-sm">
                          <Show
                            when={session.expiresAt}
                            fallback={<span class="text-[#72767d]">Never</span>}
                          >
                            {formatDate(session.expiresAt)}
                          </Show>
                        </TableCell>
                        <TableCell >
                          <button
                            onClick={() => terminateSession(session.sessionToken)}
                            disabled={loadingSessions() || isCurrentSession(session.sessionToken)}
                            class="p-2 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

            <div class="mt-4 p-3 bg-[#202225] rounded-lg">
              <h4 class="text-sm font-medium text-[#dcddde] mb-2">Session Information</h4>
              <ul class="text-xs text-[#b9bbbe] space-y-1">
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
    <div class="fixed inset-0 bg-black text-[#dcddde] bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-[#36393f] rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-2xl font-bold">User Settings</h2>
          <Button onClick={() => modalDomain.setModal({ type: "close", id: 0 })} variant="ghost" size="sm">
            <X class="w-6 h-6" />
          </Button>
        </div>
        <Tabs items={tabItems()} />
        <div class="mt-6 flex justify-end space-x-2">
          <Button onClick={async () => {
            clearSession()
            await connection.disconnect()
            userDomain.setAppState({ type: "unauthenticated" })

          }}
            variant="destructive">Logout</Button>
          <Button onClick={() => modalDomain.setModal({ type: "close", id: 0 })} variant="secondary">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UserSettingsModal;
