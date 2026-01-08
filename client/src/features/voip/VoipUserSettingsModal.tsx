import type { Component } from "solid-js";
import { Show, createMemo } from "solid-js";
import { X, Volume2, VolumeX, UserX } from "lucide-solid";
import { useModal, useUser, usePlayback, useVoip, useAcl, useAuth } from "../../store/index";
import type { CallType } from "../../store/modal";
import Avatar from "../../components/Avatar";
import Button from "../../components/Button";
import Card from "../../components/Card";
import Slider from "../../components/Slider";
import { useToaster } from "../../components/Toaster";

interface VoipUserSettingsModalProps {
  publisherId: number;
  callType: CallType;
}

const VoipUserSettingsModal: Component<VoipUserSettingsModalProps> = (props) => {
  const [, modalActions] = useModal();
  const [, userActions] = useUser();
  const [, playbackActions] = usePlayback();
  const [, voipActions] = useVoip();
  const [, aclActions] = useAcl();
  const [, authActions] = useAuth();
  const { addToast } = useToaster();

  const user = createMemo(() => userActions.findById(props.publisherId));
  const currentUser = () => authActions.getUser();
  const volume = () => Math.round(playbackActions.getVolume(props.publisherId));

  const voipSession = () => voipActions.findById(props.publisherId);
  const channelId = () => voipSession()?.channelId;

  const canKick = () => {
    const chId = channelId();
    if (!chId || props.callType === "private") return false;

    const myRights = aclActions.getChannelRights(chId, currentUser().roleId);
    if (myRights < 8) return false;

    const targetRole = user()?.roleId ?? 999;
    const myRole = currentUser().roleId;

    if (targetRole === 1 && myRole > 1) return false;
    if (targetRole === 2 && myRole > 2) return false;

    return true;
  };

  const handleKick = async () => {
    const result = await voipActions.kick(props.publisherId);
    if (result.isErr()) {
      addToast(result.error, "error");
    } else {
      modalActions.close();
    }
  };

  const toggleMute = () => {
    playbackActions.setVolume(props.publisherId, volume() === 0 ? 100 : 0);
  };

  return (
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-popover rounded-lg p-6 w-full max-w-sm mx-4">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-bold text-foreground flex items-center gap-2">
            <Volume2 class="w-5 h-5" />
            User Volume
          </h2>
          <Button onClick={() => modalActions.close()} variant="ghost" size="sm">
            <X class="w-5 h-5" />
          </Button>
        </div>

        <Show when={user()}>
          {(u) => (
            <div class="space-y-4">
              <div class="flex items-center gap-4">
                <Avatar
                  avatarFileId={u().avatarFileId}
                  alt={u().username}
                  size="lg"
                />
                <div>
                  <h3 class="text-lg font-bold text-foreground-bright">
                    {u().username}
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    {props.callType === "private" ? "Private Call" : "Voice Channel"}
                  </p>
                </div>
              </div>

              <Card>
                <Slider
                  title={`Volume: ${volume()}%`}
                  min={0}
                  max={200}
                  value={volume()}
                  onChange={(value) => playbackActions.setVolume(props.publisherId, value)}
                />
              </Card>

              <div class="flex gap-2">
                <Button
                  onClick={toggleMute}
                  variant={volume() === 0 ? "primary" : "secondary"}
                  class="flex-1 flex items-center justify-center gap-2"
                >
                  {volume() === 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  {volume() === 0 ? "Unmute" : "Mute"}
                </Button>

                <Show when={canKick()}>
                  <Button
                    onClick={handleKick}
                    variant="destructive"
                    class="flex items-center justify-center gap-2"
                  >
                    <UserX size={16} />
                    Kick
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

export default VoipUserSettingsModal;
